import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import Order, { deriveOrderStatusFromItems } from '../models/Order';
import { Product } from '../models/Product';
import { User } from '../models/User';
import { sendOrderApprovedToClient, sendOrderRejectedToClient, sendNewOrderToBroadcaster } from '../services/emailService';
import { shouldSendNotification } from '../services/notificationService';

/**
 * Projeta um pedido para a visao da EMISSORA nas listagens.
 *
 * SEGURANCA (complemento do item 3.2): `getBroadcasterOrders` e
 * `getPendingApprovalOrders` ja filtravam os ITENS por emissora, mas
 * espalhavam `...order` — o resto do documento ia inteiro, incluindo
 * CPF/CNPJ e telefone do comprador, dados de pagamento (`asaasPaymentId`,
 * bandeira e final do cartao) e as margens da plataforma (`platformSplit`,
 * `techFee`, `broadcasterAmount`, `splits[]`).
 *
 * Aqui a regra e a inversa da anterior: allowlist do que a emissora PODE ver,
 * em vez de blocklist do que remover. Campo novo no Order nao vaza por
 * esquecimento.
 */
function toBroadcasterOrderView(order: any, extras: Record<string, any> = {}) {
  return {
    _id: order._id,
    orderNumber: order.orderNumber,
    status: order.status,
    createdAt: order.createdAt,
    paidAt: order.paidAt,
    approvedAt: order.approvedAt,
    cancelledAt: order.cancelledAt,
    completedAt: order.completedAt,
    cancellationReason: order.cancellationReason,
    isFromBroadcasterProposal: order.isFromBroadcasterProposal,
    contract: order.contract,
    // Identificacao comercial do comprador — nome e o suficiente para a
    // emissora operar a campanha. Documento, e-mail e telefone nao sao.
    buyerName: order.buyerName,
    // Metodo de pagamento (a emissora precisa saber se e faturado), mas
    // nenhum identificador do gateway nem dado de cartao.
    paymentMethod: order.payment?.method,
    paymentStatus: order.payment?.status,
    ...extras,
  };
}

/**
 * Controller de Campanhas
 * Gerencia visualização e aprovação de pedidos/campanhas
 */

/**
 * Processa auto-aprovação de itens de emissoras catálogo
 * Chamado após pagamento confirmado para pular etapa de aprovação da emissora
 * 
 * @param orderId - ID do pedido
 * @returns Object com resultado do processamento
 */
export const processAutoApprovalForCatalogItems = async (orderId: string): Promise<{
  allCatalog: boolean;
  catalogItems: string[];
  regularItems: string[];
  autoApproved: boolean;
}> => {
  try {
    const order = await Order.findById(orderId);
    if (!order) {
      return { allCatalog: false, catalogItems: [], regularItems: [], autoApproved: false };
    }

    // Busca status de catálogo de todas as emissoras no pedido
    const broadcasterIds = [...new Set(order.items.map((item: any) => item.broadcasterId))];
    const broadcasters = await User.find({
      _id: { $in: broadcasterIds }
    }).select('_id isCatalogOnly companyName fantasyName email').lean();

    const catalogMap = new Map<string, boolean>();
    const broadcasterInfo = new Map<string, any>();
    broadcasters.forEach(b => {
      catalogMap.set(b._id.toString(), b.isCatalogOnly || false);
      broadcasterInfo.set(b._id.toString(), b);
    });

    // Separa itens de emissoras catálogo vs regulares
    const catalogItems: string[] = [];
    const regularItems: string[] = [];

    order.items.forEach((item: any) => {
      const isCatalog = catalogMap.get(item.broadcasterId) || false;
      if (isCatalog) {
        catalogItems.push(item.broadcasterId);
      } else {
        regularItems.push(item.broadcasterId);
      }
    });

    const allCatalog = regularItems.length === 0 && catalogItems.length > 0;



    // Se TODOS os itens são de emissoras catálogo, auto-aprova o pedido inteiro
    if (allCatalog) {

      // Atualiza status do pedido
      order.status = 'approved';
      order.approvedAt = new Date();
      order.notifications.push({
        type: 'email',
        sentAt: new Date(),
        status: 'sent',
        message: 'Pedido auto-aprovado (emissoras catálogo)'
      } as any);

      await order.save();

      // Envia email para cliente
      if (await shouldSendNotification(order.buyerId, 'ownOrderUpdates')) {
        try {
          await sendOrderApprovedToClient({
            orderNumber: order.orderNumber,
            buyerEmail: order.buyerEmail,
            buyerName: order.buyerName,
            broadcasterName: 'E-rádios (Parceiros)',
            broadcasterEmail: '',
            totalValue: order.totalAmount,
            itemsCount: order.items.length,
            createdAt: order.createdAt
          });
        } catch (emailErr) {
          // Email error silenced in production
        }
      }

      return { allCatalog: true, catalogItems, regularItems, autoApproved: true };
    }

    // Se tem MIX de catálogo e regulares, envia email apenas para emissoras regulares
    if (regularItems.length > 0) {

      const uniqueRegularIds = [...new Set(regularItems)];
      for (const broadcasterId of uniqueRegularIds) {
        const broadcaster = broadcasterInfo.get(broadcasterId);
        if (broadcaster?.email) {
          const broadcasterOrderItems = order.items.filter(
            (item: any) => item.broadcasterId === broadcasterId
          );
          const totalValue = broadcasterOrderItems.reduce(
            (sum: number, item: any) => sum + (item.unitPrice * item.quantity), 0
          );
          const itemsCount = broadcasterOrderItems.reduce(
            (sum: number, item: any) => sum + item.quantity, 0
          );

          if (await shouldSendNotification(broadcasterId, 'marketplaceOrders')) {
            try {
              await sendNewOrderToBroadcaster({
                orderNumber: order.orderNumber,
                buyerName: order.buyerName,
                buyerEmail: order.buyerEmail,
                broadcasterName: broadcaster.fantasyName || broadcaster.companyName || 'Emissora',
                broadcasterEmail: broadcaster.email,
                totalValue,
                itemsCount,
                createdAt: order.createdAt
              });
            } catch (emailErr) {
              // Email error silenced in production
            }
          }
        }
      }
    }

    return { allCatalog: false, catalogItems, regularItems, autoApproved: false };
  } catch (error: any) {
    return { allCatalog: false, catalogItems: [], regularItems: [], autoApproved: false };
  }
};

/**
 * GET /api/campaigns/my-campaigns
 * Lista todas as campanhas do comprador (advertiser/agency)
 */
export const getMyCampaigns = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ message: 'Usuário não autenticado' });
    }

    const { status, page = 1, limit = 10 } = req.query;
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 10));

    // Filtro de status (opcional)
    const filter: any = { buyerId: userId };
    if (status && status !== 'all') {
      filter.status = status;
    }

    if (req.query.isMonitoringEnabled === 'true') {
      filter.isMonitoringEnabled = true;
    }

    const skip = (pageNum - 1) * limitNum;

    const campaigns = await Order.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    const total = await Order.countDocuments(filter);

    // Coleta IDs únicos de emissoras de todas as campanhas
    const allBroadcasterIds: string[] = [];
    campaigns.forEach((campaign: any) => {
      campaign.items?.forEach((item: any) => {
        if (item.broadcasterId && !allBroadcasterIds.includes(item.broadcasterId.toString())) {
          allBroadcasterIds.push(item.broadcasterId.toString());
        }
      });
    });

    // Busca dados das emissoras (isCatalogOnly + logo/categorias p/ card e recomendações)
    const broadcasterData = await User.find({
      _id: { $in: allBroadcasterIds }
    }).select('_id isCatalogOnly companyName broadcasterProfile.logo broadcasterProfile.categories').lean();

    // Mapa de emissoras por ID
    const broadcasterMap: Record<string, any> = {};
    broadcasterData.forEach((b: any) => {
      broadcasterMap[b._id.toString()] = {
        isCatalogOnly: b.isCatalogOnly || false,
        companyName: b.companyName,
        logo: b.broadcasterProfile?.logo || '',
        categories: b.broadcasterProfile?.categories || []
      };
    });

    // Agrupa itens por emissora para cada campanha
    const campaignsWithBroadcasterStatus = campaigns.map((campaign: any) => {
      // Agrupa itens por broadcasterId
      const broadcasterGroups: any = {};

      // Verifica se alguma emissora é catálogo
      let hasCatalogBroadcasters = false;

      campaign.items.forEach((item: any) => {
        const broadcasterId = item.broadcasterId?.toString();
        const isCatalog = broadcasterMap[broadcasterId]?.isCatalogOnly || false;

        if (isCatalog) {
          hasCatalogBroadcasters = true;
        }

        if (!broadcasterGroups[broadcasterId]) {
          broadcasterGroups[broadcasterId] = {
            broadcasterId,
            broadcasterName: item.broadcasterName,
            logo: broadcasterMap[broadcasterId]?.logo || '',
            categories: broadcasterMap[broadcasterId]?.categories || [],
            isCatalogOnly: isCatalog,
            items: [],
            totalItems: 0,
            totalValue: 0,
            status: campaign.status // Usa o status da campanha (não hardcoded)
          };
        }

        broadcasterGroups[broadcasterId].items.push(item);
        broadcasterGroups[broadcasterId].totalItems += item.quantity;
        broadcasterGroups[broadcasterId].totalValue += item.totalPrice;
      });

      return {
        ...campaign,
        broadcasters: Object.values(broadcasterGroups),
        hasCatalogBroadcasters
      };
    });

    res.json({
      campaigns: campaignsWithBroadcasterStatus,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error: any) {
    res.status(500).json({
      message: 'Erro ao listar campanhas',
      error: error.message
    });
  }
};

/**
 * GET /api/campaigns/pending-approval
 * Lista pedidos aguardando aprovação da emissora (broadcaster)
 */
export const getPendingApprovalOrders = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ message: 'Usuário não autenticado' });
    }
    if (req.user?.userType !== 'broadcaster') {
      return res.status(403).json({ error: 'Apenas emissoras podem acessar esta rota' });
    }

    const orders = await Order.find({
      'items.broadcasterId': userId,
      status: { $in: ['paid', 'pending_approval'] }
    })
      .sort({ createdAt: -1 })
      .lean();

    // Busca shares dos produtos desta emissora
    const productIds = [...new Set(
      orders.flatMap(o => o.items
        .filter((item: any) => item.broadcasterId === userId)
        .map((item: any) => item.productId)
      )
    )];
    const products = await Product.find({ _id: { $in: productIds } })
      .select('_id broadcasterSharePercent')
      .lean();
    const shareMap = new Map<string, number>();
    products.forEach((p: any) => shareMap.set(p._id.toString(), p.broadcasterSharePercent ?? 80));

    // Filtra apenas os itens da emissora logada
    const ordersFiltered = orders.map(order => {
      const myItems = order.items.filter((item: any) => item.broadcasterId === userId);

      // Orders vindas de proposta da emissora: recebe 100% e ja tem descontos aplicados
      // no totalAmount (grossAmount - discountAmount global). Nao aplicar sharePercent.
      const myTotalValue = order.isFromBroadcasterProposal
        ? (order.totalAmount || 0)
        : Math.round(
            myItems.reduce((sum: number, item: any) => {
              const share = shareMap.get(item.productId?.toString()) ?? 80;
              return sum + (item.totalPrice || 0) * (share / 100);
            }, 0) * 100
          ) / 100;

      return toBroadcasterOrderView(order, {
        items: myItems.map((item: any) => ({
          ...item,
          pricePerInsertion: item.unitPrice,
        })),
        myTotalValue,
        myTotalItems: myItems.reduce((sum: number, item: any) => sum + item.quantity, 0)
      });
    });

    res.json({
      orders: ordersFiltered,
      total: ordersFiltered.length
    });
  } catch (error: any) {
    res.status(500).json({
      message: 'Erro ao listar pedidos',
      error: error.message
    });
  }
};

/**
 * GET /api/campaigns/broadcaster-orders
 * Lista TODOS os pedidos da emissora (pendentes, aprovados, recusados, etc.)
 */
export const getBroadcasterOrders = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ message: 'Usuário não autenticado' });
    }
    if (req.user?.userType !== 'broadcaster') {
      return res.status(403).json({ error: 'Apenas emissoras podem acessar esta rota' });
    }

    const { status, page = 1, limit = 100 } = req.query;


    // Filtro base: pedidos que contêm itens desta emissora
    const filter: any = {
      'items.broadcasterId': userId
    };

    // Filtro de status opcional
    if (status && status !== 'all') {
      // Se status contém vírgulas, é uma lista de status (ex: 'approved,scheduled,in_progress')
      if (typeof status === 'string' && status.includes(',')) {
        const statusArray = status.split(',').map(s => s.trim());
        filter.status = { $in: statusArray };
      } else {
        filter.status = status;
      }
    }


    const skip = (Number(page) - 1) * Number(limit);

    const [orders, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      Order.countDocuments(filter),
    ]);

    // Coleta todos os productIds dos itens desta emissora para buscar o share de cada um
    const productIds = [...new Set(
      orders.flatMap(o => o.items
        .filter((item: any) => item.broadcasterId === userId)
        .map((item: any) => item.productId)
      )
    )];

    const products = await Product.find({ _id: { $in: productIds } })
      .select('_id broadcasterSharePercent')
      .lean();

    const shareMap = new Map<string, number>();
    products.forEach((p: any) => shareMap.set(p._id.toString(), p.broadcasterSharePercent ?? 80));

    // Filtra apenas os itens da emissora logada
    const ordersFiltered = orders.map(order => {
      const myItems = order.items.filter((item: any) => item.broadcasterId === userId);

      // Calcula "minha parte" usando o broadcasterSharePercent de cada produto
      // Orders vindas de proposta da emissora: recebe 100% e ja tem descontos aplicados
      // no totalAmount (grossAmount - discountAmount global). Nao aplicar sharePercent.
      const myTotalValue = order.isFromBroadcasterProposal
        ? (order.totalAmount || 0)
        : Math.round(
            myItems.reduce((sum: number, item: any) => {
              const share = shareMap.get(item.productId?.toString()) ?? 80;
              return sum + (item.totalPrice || 0) * (share / 100);
            }, 0) * 100
          ) / 100;

      return toBroadcasterOrderView(order, {
        items: myItems.map((item: any) => ({
          ...item,
          pricePerInsertion: item.unitPrice,
        })),
        myTotalValue,
        myTotalItems: myItems.reduce((sum: number, item: any) => sum + item.quantity, 0)
      });
    });

    res.json({
      orders: ordersFiltered,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error: any) {
    res.status(500).json({
      message: 'Erro ao listar pedidos',
      error: error.message
    });
  }
};

/**
 * POST /api/campaigns/:orderId/approve-broadcaster
 * Emissora aprova seus itens em um pedido
 * -> Credita valores nas wallets conforme splits do pedido
 */
export const approveBroadcasterItems = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ message: 'Usuário não autenticado' });
    }
    if (req.user?.userType !== 'broadcaster') {
      return res.status(403).json({ error: 'Apenas emissoras podem aprovar itens' });
    }

    const { orderId } = req.params;

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: 'Pedido não encontrado' });
    }

    // Verifica se pedido está em status que permite aprovação
    if (!['paid', 'pending_approval'].includes(order.status)) {
      return res.status(400).json({
        message: `Pedido não pode ser aprovado. Status atual: ${order.status}`
      });
    }

    // Filtra os itens desta emissora
    const broadcasterItems = order.items.filter(
      (item: any) => item.broadcasterId === userId
    );

    if (broadcasterItems.length === 0) {
      return res.status(403).json({ message: 'Você não tem itens neste pedido' });
    }


    // ⚠️ IMPORTANTE: Se o pagamento é "A Faturar", NÃO credita wallets agora
    // Os valores só serão creditados após o admin aprovar E o cliente pagar a NF
    // Aprova apenas os itens desta emissora (ver deriveOrderStatusFromItems).
    broadcasterItems.forEach((item: any) => {
      item.broadcasterStatus = 'approved';
      item.broadcasterDecidedAt = new Date();
    });
    const derivedStatus = deriveOrderStatusFromItems(order.items as any);

    if (order.payment.method === 'billing') {

      // So avanca o pedido quando TODAS as emissoras decidiram.
      if (derivedStatus === 'approved') {
        order.status = 'approved';
        order.approvedAt = new Date();
      } else if (derivedStatus === 'cancelled') {
        order.status = 'cancelled';
        order.cancelledAt = new Date();
      }
      await order.save();

      // Pega os dados da primeira emissora (pode haver múltiplas)
      const firstBroadcasterItem = order.items.find(
        (item: any) => item.broadcasterId === userId
      ) || order.items[0];

      if (firstBroadcasterItem && await shouldSendNotification(order.buyerId, 'ownOrderUpdates')) {
        await sendOrderApprovedToClient({
          orderNumber: order.orderNumber,
          buyerEmail: order.buyerEmail,
          buyerName: order.buyerName,
          broadcasterName: firstBroadcasterItem.broadcasterName,
          broadcasterEmail: '', // Não usado neste email
          totalValue: order.totalAmount,
          itemsCount: order.items.length,
          createdAt: order.createdAt
        });
      }

      return res.json({
        message: 'Pedido aprovado com sucesso! Aguardando validação do admin e pagamento da NF.',
        order: {
          orderNumber: order.orderNumber,
          status: order.status,
          billingStatus: order.billingStatus
        }
      });
    }

    // Status do pedido derivado das decisoes por item (nao sobrescreve
    // decisao de outras emissoras).
    if (derivedStatus === 'approved') {
      order.status = 'approved';
      order.approvedAt = new Date();
    } else if (derivedStatus === 'cancelled') {
      order.status = 'cancelled';
      order.cancelledAt = new Date();
    }

    order.notifications.push({
      type: 'email',
      sentAt: new Date(),
      status: 'sent',
      message: 'Itens aprovados pela emissora'
    } as any);

    await order.save();

    // Busca dados da emissora para o email
    const broadcaster = await User.findById(userId);
    const broadcasterName = broadcaster?.fantasyName || broadcaster?.companyName || 'Emissora';

    const broadcasterSplit = order.splits.find((s: any) => s.recipientType === 'broadcaster');

    if (await shouldSendNotification(order.buyerId, 'ownOrderUpdates')) {
      sendOrderApprovedToClient({
        orderNumber: order.orderNumber,
        buyerName: order.buyerName,
        buyerEmail: order.buyerEmail,
        broadcasterName,
        broadcasterEmail: broadcaster?.email || '',
        totalValue: broadcasterSplit?.amount || 0,
        itemsCount: broadcasterItems.reduce((sum: number, item: any) => sum + item.quantity, 0),
        createdAt: order.createdAt
      }).catch(() => {});
    }

    res.json({
      success: true,
      message: 'Pedido aprovado com sucesso!',
      order
    });
  } catch (error: any) {
    res.status(500).json({
      message: 'Erro ao aprovar pedido',
      error: error.message
    });
  }
};

/**
 * POST /api/campaigns/:orderId/reject-broadcaster
 * Emissora recusa seus itens em um pedido
 * -> Estorna o valor para a wallet do comprador
 */
export const rejectBroadcasterItems = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ message: 'Usuário não autenticado' });
    }
    if (req.user?.userType !== 'broadcaster') {
      return res.status(403).json({ error: 'Apenas emissoras podem recusar itens' });
    }

    const { orderId } = req.params;
    const { reason } = req.body;

    if (!reason || reason.trim().length < 10) {
      return res.status(400).json({
        message: 'Informe um motivo válido para a recusa (mínimo 10 caracteres)'
      });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: 'Pedido não encontrado' });
    }

    // Verifica se pedido está em status que permite recusa
    if (!['paid', 'pending_approval'].includes(order.status)) {
      return res.status(400).json({
        message: `Pedido não pode ser recusado. Status atual: ${order.status}`
      });
    }

    // Filtra os itens desta emissora
    const broadcasterItems = order.items.filter(
      (item: any) => item.broadcasterId === userId
    );

    if (broadcasterItems.length === 0) {
      return res.status(403).json({ message: 'Você não tem itens neste pedido' });
    }

    // Calcula o valor total a ser estornado ao comprador
    // (valor dos itens + proporção da taxa da plataforma)
    const itemsValue = broadcasterItems.reduce(
      (sum: number, item: any) => sum + item.totalPrice, 0
    );

    // Calcula a taxa proporcional (20% sobre os itens recusados)
    const proportionalFee = itemsValue * 0.20;
    const totalRefund = itemsValue + proportionalFee;


    // Recusa APENAS os itens desta emissora. O status do pedido e derivado:
    // sem isso, uma emissora com 1 item cancelava a venda ja paga das demais.
    broadcasterItems.forEach((item: any) => {
      item.broadcasterStatus = 'rejected';
      item.broadcasterDecidedAt = new Date();
      item.rejectionReason = reason;
    });

    const derived = deriveOrderStatusFromItems(order.items as any);
    if (derived === 'cancelled') {
      order.status = 'cancelled';
      order.cancelledAt = new Date();
      order.cancellationReason = `Recusado pela emissora: ${reason}`;
    } else if (derived === 'approved') {
      // As demais emissoras aprovaram — o pedido segue, sem os itens recusados.
      order.status = 'approved';
      order.approvedAt = new Date();
    }
    // derived === null: ainda ha emissoras por decidir, status nao muda.

    // Adiciona log de notificação
    order.notifications.push({
      type: 'email',
      sentAt: new Date(),
      status: 'sent',
      message: `Itens recusados pela emissora. Motivo: ${reason}. Valor estornado: R$ ${totalRefund.toFixed(2)}`
    } as any);

    await order.save();


    // Busca dados da emissora para o email
    const broadcaster = await User.findById(userId);
    const broadcasterName = broadcaster?.fantasyName || broadcaster?.companyName || 'Emissora';

    // Envia email para o cliente
    if (await shouldSendNotification(order.buyerId, 'ownOrderUpdates')) {
      sendOrderRejectedToClient({
        orderNumber: order.orderNumber,
        buyerName: order.buyerName,
        buyerEmail: order.buyerEmail,
        broadcasterName,
        broadcasterEmail: broadcaster?.email || '',
        totalValue: totalRefund,
        itemsCount: broadcasterItems.reduce((sum: number, item: any) => sum + item.quantity, 0),
        createdAt: order.createdAt,
        reason
      }).catch(() => {});
    }

    res.json({
      success: true,
      message: `Pedido recusado. R$ ${totalRefund.toFixed(2)} foi estornado ao comprador.`,
      order,
      refund: {
        amount: totalRefund,
        itemsValue,
        feeValue: proportionalFee
      }
    });
  } catch (error: any) {
    res.status(500).json({
      message: 'Erro ao recusar pedido',
      error: error.message
    });
  }
};

/**
 * GET /api/campaigns/:orderId
 * Detalhes de uma campanha específica
 */
export const getCampaignDetails = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ message: 'Usuário não autenticado' });
    }

    const { orderId } = req.params;

    const order = await Order.findById(orderId).lean();
    if (!order) {
      return res.status(404).json({ message: 'Campanha não encontrada' });
    }

    // Verifica permissão (comprador, emissora envolvida ou admin)
    const isAdmin = req.user?.userType === 'admin';
    const isBuyer = order.buyerId.toString() === userId;
    const isBroadcaster = order.items.some((item: any) => item.broadcasterId === userId);

    if (!isAdmin && !isBuyer && !isBroadcaster) {
      return res.status(403).json({ message: 'Você não tem permissão para ver esta campanha' });
    }

    // SEGURANCA (3.2): a emissora ve APENAS os proprios itens.
    // Espalhar `...order` entregava a ela o CPF/CNPJ e telefone do comprador,
    // os precos praticados pelas concorrentes no mesmo pedido, os dados de
    // pagamento e as margens da plataforma (platformSplit/techFee/
    // broadcasterAmount). E as URLs de material de todas as emissoras, que
    // alimentavam o download cruzado via /api/upload/signed-url.
    const isBuyerOrAdmin = isBuyer || isAdmin;
    const visibleItems = isBuyerOrAdmin
      ? order.items
      : order.items.filter((item: any) => item.broadcasterId === userId);

    // Agrupa por emissora (apenas sobre o que este ator pode ver)
    const broadcasterGroups: any = {};
    visibleItems.forEach((item: any) => {
      const broadcasterId = item.broadcasterId;
      if (!broadcasterGroups[broadcasterId]) {
        broadcasterGroups[broadcasterId] = {
          broadcasterId,
          broadcasterName: item.broadcasterName,
          items: [],
          totalItems: 0,
          totalValue: 0,
          status: 'pending_approval'
        };
      }

      broadcasterGroups[broadcasterId].items.push(item);
      broadcasterGroups[broadcasterId].totalItems += item.quantity;
      broadcasterGroups[broadcasterId].totalValue += item.totalPrice;
    });

    const campaign: any = {
      _id: order._id,
      orderNumber: order.orderNumber,
      status: order.status,
      createdAt: order.createdAt,
      paidAt: order.paidAt,
      approvedAt: order.approvedAt,
      cancelledAt: order.cancelledAt,
      completedAt: order.completedAt,
      cancellationReason: order.cancellationReason,
      buyerName: order.buyerName,
      items: visibleItems,
      broadcasters: Object.values(broadcasterGroups),
    };

    if (isBuyerOrAdmin) {
      // Comprador e admin veem o pedido financeiro completo.
      Object.assign(campaign, {
        buyerId: order.buyerId,
        buyerEmail: order.buyerEmail,
        buyerPhone: order.buyerPhone,
        buyerDocument: order.buyerDocument,
        clientId: order.clientId,
        payment: order.payment,
        splits: order.splits,
        totalAmount: order.totalAmount,
        subtotal: order.subtotal,
        grossAmount: order.grossAmount,
        agencyCommission: order.agencyCommission,
        monitoringCost: order.monitoringCost,
        isMonitoringEnabled: order.isMonitoringEnabled,
        contract: order.contract,
        billingStatus: order.billingStatus,
      });
    } else {
      // Emissora ve apenas o proprio faturamento nesta campanha.
      campaign.myTotalValue = visibleItems.reduce(
        (sum: number, item: any) => sum + (item.totalPrice || 0),
        0
      );
    }

    res.json({ campaign });
  } catch (error: any) {
    res.status(500).json({
      message: 'Erro ao buscar campanha',
      error: error.message
    });
  }
};

const MONTHS_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/**
 * GET /api/campaigns/last-completed
 * Resumo do último pedido concluído do comprador (base do banner "Repetir campanha").
 */
export const getLastCompleted = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: 'Usuário não autenticado' });
      return;
    }
    const order = await Order.findOne({
      buyerId: req.userId,
      status: { $in: ['completed', 'completed_billing'] },
    }).sort({ createdAt: -1 }).lean();

    if (!order) {
      res.json({ order: null });
      return;
    }

    const stationNames = [...new Set((order.items || []).map((i: any) => i.broadcasterName).filter(Boolean))];
    const insertionsCount = (order.items || []).reduce((s: number, i: any) => s + (i.quantity ?? 0), 0);
    res.json({
      order: {
        _id: order._id,
        orderNumber: order.orderNumber,
        month: MONTHS_PT[new Date(order.createdAt as any).getMonth()],
        stationNames,
        stationsCount: stationNames.length,
        insertionsCount,
        totalAmount: order.totalAmount,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar última campanha' });
  }
};
