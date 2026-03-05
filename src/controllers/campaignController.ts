import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import Order from '../models/Order';
import Wallet from '../models/Wallet';
import { User } from '../models/User';
import { sendOrderApprovedToClient, sendOrderRejectedToClient, sendNewOrderToBroadcaster } from '../services/emailService';
import { createConversationFromOrder } from './chatController';

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
      console.warn(`⚠️ Pedido ${orderId} não encontrado para auto-aprovação`);
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

      // Credita valores na wallet da plataforma (emissoras catálogo não recebem via wallet)
      for (const split of order.splits) {
        if (split.recipientType === 'platform') {
          const { ensurePlatformWallet } = await import('./paymentController');
          const platformWallet = await ensurePlatformWallet();

          await platformWallet.addCredit(
            split.amount,
            `Pedido ${order.orderNumber} - ${split.description} (Auto-aprovado)`,
            order._id
          );

        }
        // Emissoras catálogo NÃO recebem crédito via wallet (são pagas por fora)
      }

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
        console.error('❌ Erro ao enviar email de aprovação:', emailErr);
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
            console.error(`❌ Erro ao enviar email para ${broadcaster.email}:`, emailErr);
          }
        }
      }
    }

    return { allCatalog: false, catalogItems, regularItems, autoApproved: false };
  } catch (error: any) {
    console.error(`❌ Erro no processamento de auto-aprovação:`, error);
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

    // Filtro de status (opcional)
    const filter: any = { buyerId: userId };
    if (status && status !== 'all') {
      filter.status = status;
    }

    if (req.query.isMonitoringEnabled === 'true') {
      filter.isMonitoringEnabled = true;
    }

    const skip = (Number(page) - 1) * Number(limit);

    const campaigns = await Order.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
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

    // Busca dados das emissoras (incluindo isCatalogOnly)
    const broadcasterData = await User.find({
      _id: { $in: allBroadcasterIds }
    }).select('_id isCatalogOnly companyName').lean();

    // Mapa de emissoras por ID
    const broadcasterMap: Record<string, any> = {};
    broadcasterData.forEach((b: any) => {
      broadcasterMap[b._id.toString()] = {
        isCatalogOnly: b.isCatalogOnly || false,
        companyName: b.companyName
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
    console.error('❌ Erro ao listar campanhas:', error);
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

    // Busca pedidos que contêm itens desta emissora
    const orders = await Order.find({
      'items.broadcasterId': userId,
      status: { $in: ['paid', 'pending_approval'] }
    })
      .sort({ createdAt: -1 })
      .lean();

    // Filtra apenas os itens da emissora logada
    const ordersFiltered = orders.map(order => {
      const myItems = order.items.filter((item: any) => item.broadcasterId === userId);

      // Calcula valor real que a emissora receberá (80% do valor bruto)
      // Busca no array de splits o valor destinado a esta emissora
      const mySplits = (order as any).splits?.filter((split: any) =>
        split.recipientType === 'broadcaster' && split.recipientId === userId
      ) || [];

      const myTotalValue = mySplits.reduce((sum: number, split: any) => sum + (split.amount || 0), 0);

      return {
        ...order,
        items: myItems,
        myTotalValue, // Valor real (80% do bruto)
        myTotalItems: myItems.reduce((sum: number, item: any) => sum + item.quantity, 0)
      };
    });

    res.json({
      orders: ordersFiltered,
      total: ordersFiltered.length
    });
  } catch (error: any) {
    console.error('❌ Erro ao listar pedidos pendentes:', error);
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

    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean();

    const total = await Order.countDocuments(filter);


    // Filtra apenas os itens da emissora logada
    const ordersFiltered = orders.map(order => {
      const myItems = order.items.filter((item: any) => item.broadcasterId === userId);

      // Calcula valor real que a emissora receberá (80% do valor bruto)
      // Busca no array de splits o valor destinado a esta emissora
      const mySplits = (order as any).splits?.filter((split: any) =>
        split.recipientType === 'broadcaster' && split.recipientId === userId
      ) || [];

      const myTotalValue = mySplits.reduce((sum: number, split: any) => sum + (split.amount || 0), 0);

      return {
        ...order,
        items: myItems,
        myTotalValue, // Valor real (80% do bruto)
        myTotalItems: myItems.reduce((sum: number, item: any) => sum + item.quantity, 0)
      };
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
    console.error('❌ Erro ao listar pedidos da emissora:', error);
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
    if (order.payment.method === 'billing') {

      // Apenas marca como aprovado pela emissora
      order.status = 'approved';
      order.approvedAt = new Date();
      await order.save();

      // Pega os dados da primeira emissora (pode haver múltiplas)
      const firstBroadcasterItem = order.items.find(
        (item: any) => item.broadcasterId === userId
      ) || order.items[0];

      if (firstBroadcasterItem) {
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

    // Credita valores conforme array de splits (apenas para pagamentos já processados)
    const creditResults: any[] = [];

    for (const split of order.splits) {

      if (split.recipientType === 'broadcaster') {
        // Credita wallet da emissora
        let broadcasterWallet = await Wallet.findOne({ userId: split.recipientId });
        if (!broadcasterWallet) {
          broadcasterWallet = await Wallet.create({
            userId: split.recipientId,
            balance: 0,
            blockedBalance: 0,
            totalEarned: 0,
            totalSpent: 0,
            transactions: []
          });
        }

        await broadcasterWallet.addCredit(
          split.amount,
          `Pedido ${order.orderNumber} - ${split.description}`,
          order._id
        );

        creditResults.push({
          recipientType: 'broadcaster',
          recipientName: split.recipientName,
          amount: split.amount,
          newBalance: broadcasterWallet.balance + split.amount
        });

      }

      else if (split.recipientType === 'platform') {
        // Credita wallet da plataforma
        const { ensurePlatformWallet } = await import('./paymentController');
        const platformWallet = await ensurePlatformWallet();

        await platformWallet.addCredit(
          split.amount,
          `Pedido ${order.orderNumber} - ${split.description}`,
          order._id
        );

        creditResults.push({
          recipientType: 'platform',
          recipientName: split.recipientName,
          amount: split.amount,
          newBalance: platformWallet.balance + split.amount
        });

      }

      else if (split.recipientType === 'agency') {
        // Credita wallet da agência
        let agencyWallet = await Wallet.findOne({ userId: split.recipientId });
        if (!agencyWallet) {
          agencyWallet = await Wallet.create({
            userId: split.recipientId,
            balance: 0,
            blockedBalance: 0,
            totalEarned: 0,
            totalSpent: 0,
            transactions: []
          });
        }

        await agencyWallet.addCredit(
          split.amount,
          `Pedido ${order.orderNumber} - ${split.description}`,
          order._id
        );

        creditResults.push({
          recipientType: 'agency',
          recipientName: split.recipientName,
          amount: split.amount,
          newBalance: agencyWallet.balance + split.amount
        });

      }
    }

    // Atualiza o status do pedido
    order.status = 'approved';
    order.approvedAt = new Date();

    // Adiciona log de notificação
    const totalCredited = creditResults.reduce((sum, r) => sum + r.amount, 0);
    order.notifications.push({
      type: 'email',
      sentAt: new Date(),
      status: 'sent',
      message: `Pedido aprovado. Total distribuído: R$ ${totalCredited.toFixed(2)} entre ${creditResults.length} recipientes`
    } as any);

    await order.save();

    // Cria conversa no chat se ainda não existir
    try {
      await createConversationFromOrder(order._id.toString());
    } catch (chatError) {
      console.error('❌ Erro ao criar conversa:', chatError);
      // Não bloqueia a aprovação se houver erro no chat
    }

    // Busca wallet atualizada da emissora
    const updatedWallet = await Wallet.findOne({ userId });
    const broadcasterCredit = creditResults.find(r => r.recipientType === 'broadcaster');


    // Busca dados da emissora para o email
    const broadcaster = await User.findById(userId);
    const broadcasterName = broadcaster?.fantasyName || broadcaster?.companyName || 'Emissora';

    // Envia email para o cliente
    sendOrderApprovedToClient({
      orderNumber: order.orderNumber,
      buyerName: order.buyerName,
      buyerEmail: order.buyerEmail,
      broadcasterName,
      broadcasterEmail: broadcaster?.email || '',
      totalValue: broadcasterCredit?.amount || 0,
      itemsCount: broadcasterItems.reduce((sum: number, item: any) => sum + item.quantity, 0),
      createdAt: order.createdAt
    }).catch(err => console.error('❌ Erro ao enviar email de aprovação:', err));

    res.json({
      success: true,
      message: `Pedido aprovado! R$ ${broadcasterCredit?.amount.toFixed(2) || '0.00'} foi creditado em sua carteira.`,
      order,
      wallet: {
        balance: updatedWallet?.balance || 0,
        totalEarned: updatedWallet?.totalEarned || 0,
        creditedAmount: broadcasterCredit?.amount || 0
      },
      creditSummary: creditResults
    });
  } catch (error: any) {
    console.error('❌ Erro ao aprovar pedido:', error);
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


    // Busca ou cria wallet do comprador
    let buyerWallet = await Wallet.findOne({ userId: order.buyerId });
    if (!buyerWallet) {
      buyerWallet = await Wallet.create({
        userId: order.buyerId,
        balance: 0,
        blockedBalance: 0,
        totalEarned: 0,
        totalSpent: 0,
        transactions: []
      });
    }

    // Credita o estorno na wallet do comprador
    await buyerWallet.addCredit(
      totalRefund,
      `Estorno - Pedido ${order.orderNumber} recusado pela emissora. Motivo: ${reason}`,
      order._id
    );


    // Atualiza o status do pedido
    order.status = 'cancelled';
    order.cancelledAt = new Date();
    order.cancellationReason = `Recusado pela emissora: ${reason}`;

    // Adiciona log de notificação
    order.notifications.push({
      type: 'email',
      sentAt: new Date(),
      status: 'sent',
      message: `Pedido recusado pela emissora. Motivo: ${reason}. Valor estornado: R$ ${totalRefund.toFixed(2)}`
    } as any);

    await order.save();


    // Busca dados da emissora para o email
    const broadcaster = await User.findById(userId);
    const broadcasterName = broadcaster?.fantasyName || broadcaster?.companyName || 'Emissora';

    // Envia email para o cliente
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
    }).catch(err => console.error('❌ Erro ao enviar email de recusa:', err));

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
    console.error('❌ Erro ao recusar pedido:', error);
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

    // Verifica permissão (comprador ou emissora envolvida)
    const isBuyer = order.buyerId.toString() === userId;
    const isBroadcaster = order.items.some((item: any) => item.broadcasterId === userId);

    if (!isBuyer && !isBroadcaster) {
      return res.status(403).json({ message: 'Você não tem permissão para ver esta campanha' });
    }

    // Agrupa por emissora
    const broadcasterGroups: any = {};
    order.items.forEach((item: any) => {
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

    res.json({
      campaign: {
        ...order,
        broadcasters: Object.values(broadcasterGroups)
      }
    });
  } catch (error: any) {
    console.error('❌ Erro ao buscar detalhes da campanha:', error);
    res.status(500).json({
      message: 'Erro ao buscar campanha',
      error: error.message
    });
  }
};
