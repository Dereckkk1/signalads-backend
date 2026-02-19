import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { User } from '../models/User';
import { Conversation } from '../models/Conversation';
import WalletModel, { IWallet } from '../models/Wallet';
import OrderModel, { IOrder } from '../models/Order';
import { AuthRequest } from '../middleware/auth';
import asaasService from '../services/asaasService';
import { Cart } from '../models/Cart';
import bcrypt from 'bcryptjs';

// Listar emissoras pendentes de aprovação
export const getPendingBroadcasters = async (req: Request, res: Response): Promise<void> => {
  try {
    const pendingBroadcasters = await User.find({
      userType: 'broadcaster',
      status: 'pending'
    }).select('-password').sort({ createdAt: -1 });

    res.json({
      total: pendingBroadcasters.length,
      broadcasters: pendingBroadcasters
    });
  } catch (error) {
    console.error('Erro ao buscar emissoras pendentes:', error);
    res.status(500).json({ error: 'Erro ao buscar emissoras pendentes' });
  }
};

// Aprovar emissora
export const approveBroadcaster = async (req: Request, res: Response): Promise<void> => {
  try {
    const { broadcasterId } = req.params;

    const broadcaster = await User.findById(broadcasterId);

    if (!broadcaster) {
      res.status(404).json({ error: 'Emissora não encontrada' });
      return;
    }

    if (broadcaster.userType !== 'broadcaster') {
      res.status(400).json({ error: 'Usuário não é uma emissora' });
      return;
    }

    broadcaster.status = 'approved';
    delete broadcaster.rejectionReason; // Remove o campo em vez de setar undefined
    await broadcaster.save();



    // Criar conversa de suporte com admin
    try {
      const admin = await User.findOne({ userType: 'admin' }).sort({ createdAt: 1 });

      if (admin) {
        const existingConversation = await Conversation.findOne({
          advertiserId: admin._id.toString(),
          broadcasterId: broadcasterId
        });

        if (!existingConversation) {
          const broadcasterProfile = broadcaster.broadcasterProfile;
          const generalInfo = broadcasterProfile?.generalInfo || {};

          const conversation = new Conversation({
            advertiserId: admin._id.toString(),
            advertiserName: 'Suporte E-rádios',
            broadcasterId: broadcasterId,
            broadcasterName: generalInfo.stationName || broadcaster.companyName || 'Emissora',
            broadcasterLogo: broadcasterProfile?.logo || '',
            broadcasterDial: generalInfo.dialFrequency || '',
            broadcasterBand: generalInfo.band || '',
            messages: [{
              senderId: admin._id.toString(),
              senderName: 'Suporte E-rádios',
              senderType: 'admin',
              message: `Olá ${generalInfo.stationName || broadcaster.companyName}! 👋\n\nParabéns! Seu cadastro foi aprovado e você já pode começar a receber campanhas.\n\nEste é o canal de suporte da plataforma E-rádios. Estamos aqui para ajudar com qualquer dúvida.\n\nBem-vindo(a) à plataforma!`,
              timestamp: new Date(),
              read: false
            }],
            relatedOrders: [],
            lastMessageAt: new Date(),
            lastMessageBy: admin._id.toString(),
            unreadCount: {
              advertiser: 0,
              broadcaster: 1
            }
          });

          await conversation.save();
        }
      }
    } catch (chatError) {
      console.error('⚠️ Erro ao criar conversa de suporte (não crítico):', chatError);
    }

    res.json({
      message: 'Emissora aprovada com sucesso!',
      broadcaster: {
        id: broadcaster._id,
        email: broadcaster.email,
        companyName: broadcaster.companyName,
        status: broadcaster.status
      }
    });
  } catch (error) {
    console.error('Erro ao aprovar emissora:', error);
    res.status(500).json({ error: 'Erro ao aprovar emissora' });
  }
};

// Reprovar emissora
export const rejectBroadcaster = async (req: Request, res: Response): Promise<void> => {
  try {
    const { broadcasterId } = req.params;
    const { reason } = req.body;

    const broadcaster = await User.findById(broadcasterId);

    if (!broadcaster) {
      res.status(404).json({ error: 'Emissora não encontrada' });
      return;
    }

    if (broadcaster.userType !== 'broadcaster') {
      res.status(400).json({ error: 'Usuário não é uma emissora' });
      return;
    }

    broadcaster.status = 'rejected';
    broadcaster.rejectionReason = reason || 'Cadastro reprovado pela administração.';
    await broadcaster.save();



    res.json({
      message: 'Emissora reprovada',
      broadcaster: {
        id: broadcaster._id,
        email: broadcaster.email,
        companyName: broadcaster.companyName,
        status: broadcaster.status,
        rejectionReason: broadcaster.rejectionReason
      }
    });
  } catch (error) {
    console.error('Erro ao reprovar emissora:', error);
    res.status(500).json({ error: 'Erro ao reprovar emissora' });
  }
};

// Listar todas as emissoras (com filtro de status opcional)
export const getAllBroadcasters = async (req: Request, res: Response): Promise<void> => {
  try {
    const { status } = req.query;

    const filter: any = { userType: 'broadcaster' };
    if (status) {
      filter.status = status;
    }

    const broadcasters = await User.find(filter)
      .select('-password')
      .sort({ createdAt: -1 });

    res.json({
      total: broadcasters.length,
      broadcasters
    });
  } catch (error) {
    console.error('Erro ao buscar emissoras:', error);
    res.status(500).json({ error: 'Erro ao buscar emissoras' });
  }
};

// Listar emissoras para o painel de gestão do admin (com informações completas)
// Listar emissoras para o painel de gestão do admin (com informações completas) e Paginação
export const getBroadcastersForManagement = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page = 1, limit = 25, search, status } = req.query;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.max(1, Number(limit));
    const skip = (pageNum - 1) * limitNum;


    // Filtro base
    const filter: any = { userType: 'broadcaster' };

    // Filtro por status
    if (status && status !== 'all') {
      filter.status = status;
    } else {
      // Por padrão aprovadas, a menos que especificado
      // Mas o frontend envia 'all', então vamos considerar todos se status não for passado ou for all
      if (!status) filter.status = 'approved';
    }

    // Busca com Search (se houver termo de busca, complicamos um pouco pois precisa buscar no profile)
    // O ideal seria usar aggregation, mas vamos manter simples por enquanto buscado primeiro
    // Se tiver busca, a gente filtra depois ou faz uma query mais complexa
    // Vamos fazer uma query básica por empresa/email no mongo, profile precisa de $regex
    if (search) {
      filter.$or = [
        { companyName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { 'broadcasterProfile.generalInfo.stationName': { $regex: search, $options: 'i' } }
      ];
    }

    // Contagem total
    const total = await User.countDocuments(filter);

    // Busca paginada
    const broadcasters = await User.find(filter)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    // Para cada emissora, buscar se existe conversa com o admin
    const broadcastersWithChat = await Promise.all(
      broadcasters.map(async (broadcaster) => {
        const conversation = await Conversation.findOne({
          broadcasterId: broadcaster._id.toString(),
          advertiserName: 'Suporte E-rádios'
        }).lean();

        return {
          ...broadcaster,
          hasAdminChat: !!conversation,
          conversationId: conversation?._id || null,
          lastMessageAt: conversation?.lastMessageAt || null
        };
      })
    );


    res.json({
      total,
      hasMore: pageNum * limitNum < total,
      totalPages: Math.ceil(total / limitNum),
      broadcasters: broadcastersWithChat
    });
  } catch (error) {
    console.error('❌ Erro ao buscar emissoras para gestão:', error);
    res.status(500).json({ error: 'Erro ao buscar emissoras' });
  }
};

// Criar ou buscar conversa entre admin e emissora
export const getOrCreateAdminConversation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { broadcasterId } = req.params;
    const adminId = req.user?._id?.toString();


    if (!adminId) {
      res.status(401).json({ message: 'Admin não autenticado' });
      return;
    }

    // Buscar dados da emissora
    const broadcaster = await User.findById(broadcasterId).select('-password');

    if (!broadcaster || broadcaster.userType !== 'broadcaster') {
      res.status(404).json({ message: 'Emissora não encontrada' });
      return;
    }

    // Buscar conversa existente (admin usa campo advertiserId)
    let conversation = await Conversation.findOne({
      advertiserId: adminId,
      broadcasterId: broadcasterId
    });

    // Se não existe, criar nova conversa
    if (!conversation) {

      const broadcasterProfile = broadcaster.broadcasterProfile;
      const generalInfo = broadcasterProfile?.generalInfo || {};

      conversation = new Conversation({
        advertiserId: adminId,
        advertiserName: 'Suporte E-rádios',
        broadcasterId: broadcasterId,
        broadcasterName: generalInfo.stationName || broadcaster.companyName || 'Emissora',
        broadcasterLogo: broadcasterProfile?.logo || '',
        broadcasterDial: generalInfo.dialFrequency || '',
        broadcasterBand: generalInfo.band || '',
        messages: [],
        relatedOrders: [],
        lastMessageAt: new Date(),
        unreadCount: {
          advertiser: 0,
          broadcaster: 0
        }
      });

      await conversation.save();
    } else {
    }

    res.json({ conversation });
  } catch (error: any) {
    console.error('❌ Erro ao criar/buscar conversa admin:', error);
    res.status(500).json({ message: 'Erro ao processar conversa', error: error.message });
  }
};

// Buscar detalhes completos de uma emissora (admin)
export const getBroadcasterDetails = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const broadcaster = await User.findById(id).select('-password');

    if (!broadcaster) {
      res.status(404).json({ error: 'Emissora não encontrada' });
      return;
    }

    if (broadcaster.userType !== 'broadcaster') {
      res.status(400).json({ error: 'Usuário não é uma emissora' });
      return;
    }



    res.json({ broadcaster });
  } catch (error) {
    console.error('❌ Erro ao buscar detalhes da emissora:', error);
    res.status(500).json({ error: 'Erro ao buscar detalhes da emissora' });
  }
};

// Buscar dados financeiros da emissora (wallet)
export const getBroadcasterWallet = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    // Verifica se a emissora existe
    const broadcaster = await User.findById(id);
    if (!broadcaster || broadcaster.userType !== 'broadcaster') {
      res.status(404).json({ error: 'Emissora não encontrada' });
      return;
    }

    // Busca wallet da emissora
    let wallet = await WalletModel.findOne({ userId: id });

    if (!wallet) {
      // Cria wallet se não existir
      wallet = new WalletModel({
        userId: id,
        balance: 0,
        blockedBalance: 0,
        totalEarned: 0,
        totalSpent: 0,
        transactions: []
      });
      await wallet.save();
    }

    // Valores da wallet
    const balance = wallet.balance || 0;
    const blockedBalance = wallet.blockedBalance || 0;
    const totalEarned = wallet.totalEarned || 0;

    // Busca TODOS os pedidos da emissora que foram pagos (mesma lógica do painel financeiro)
    const allPaidOrders = await OrderModel.find({
      'items.broadcasterId': id,
      status: { $nin: ['pending_payment', 'cancelled', 'pending_billing_validation', 'billing_rejected'] }
    }).select('orderNumber status splits broadcasterAmount payment createdAt paidAt');

    // Calcula total ganho historicamente (soma dos splits em pedidos pagos)
    let totalFromOrders = 0;
    for (const order of allPaidOrders) {
      const broadcasterSplits = order.splits?.filter((split: any) =>
        split.recipientId?.toString() === id && split.recipientType === 'broadcaster'
      ) || [];

      const orderAmount = broadcasterSplits.reduce((sum: number, split: any) =>
        sum + (split.amount || 0), 0
      );

      totalFromOrders += orderAmount;
    }

    // Busca orders PAGOS mas NÃO APROVADOS ainda (receita pendente de aprovação da emissora)
    // Quando emissora aprovar, os valores serão creditados na wallet
    const pendingOrders = await OrderModel.find({
      'items.broadcasterId': id,
      status: { $in: ['paid', 'pending_approval'] }, // Pagos mas aguardando aprovação da emissora
      'payment.method': { $ne: 'billing' } // Exclui "A Faturar" (tem fluxo diferente)
    }).select('splits');

    // Calcula valor pendente (aguardando aprovação da emissora)
    let pendingAmount = 0;
    for (const order of pendingOrders) {
      const broadcasterSplits = order.splits?.filter((split: any) =>
        split.recipientId?.toString() === id && split.recipientType === 'broadcaster'
      ) || [];

      const orderPendingAmount = broadcasterSplits.reduce((sum: number, split: any) =>
        sum + (split.amount || 0), 0
      );

      pendingAmount += orderPendingAmount;
    }

    // Pega últimas 20 transações da wallet
    const recentTransactions = wallet.transactions
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 20);



    res.json({
      balance,
      blockedBalance,
      totalEarned, // Total acumulado na wallet
      totalFromOrders, // Total calculado dos pedidos (deve bater com totalEarned)
      pendingAmount,
      transactions: recentTransactions,
      // Estatísticas adicionais
      stats: {
        paidOrders: allPaidOrders.length,
        pendingOrders: pendingOrders.length,
        totalOrders: allPaidOrders.length + pendingOrders.length
      }
    });
  } catch (error) {
    console.error('❌ Erro ao buscar wallet da emissora:', error);
    res.status(500).json({ error: 'Erro ao buscar dados financeiros' });
  }
};

// Buscar campanhas da emissora
export const getBroadcasterCampaigns = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    // Verifica se a emissora existe
    const broadcaster = await User.findById(id);
    if (!broadcaster || broadcaster.userType !== 'broadcaster') {
      res.status(404).json({ error: 'Emissora não encontrada' });
      return;
    }

    // Busca todos os pedidos relacionados à emissora
    const orders = await OrderModel.find({
      'items.broadcasterId': id
    })
      .populate('buyerId', 'name email userType')
      .sort({ createdAt: -1 });

    // Categoriza campanhas por status
    const activeCampaigns = orders.filter((order: IOrder) =>
      order.status === 'approved' || order.status === 'scheduled' || order.status === 'in_progress'
    );

    const completedCampaigns = orders.filter((order: IOrder) =>
      order.status === 'completed'
    );

    const cancelledCampaigns = orders.filter((order: IOrder) =>
      order.status === 'cancelled' || order.status === 'expired' || order.status === 'refunded' || order.status === 'billing_rejected'
    );



    res.json({
      total: orders.length,
      active: activeCampaigns,
      completed: completedCampaigns,
      cancelled: cancelledCampaigns
    });
  } catch (error) {
    console.error('❌ Erro ao buscar campanhas da emissora:', error);
    res.status(500).json({ error: 'Erro ao buscar campanhas' });
  }
};

/**
 * GET /api/admin/orders/full
 * Retorna TODOS os pedidos com detalhes completos para o admin
 * Inclui: cliente, emissoras, produtos, datas de veiculação, valores, splits
 */
export const getFullOrdersForAdmin = async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, startDate, endDate, search, page = 1, limit = 25 } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Monta filtro base
    const filter: any = {};

    if (status && status !== 'all') {
      filter.status = status;
    }

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) {
        filter.createdAt.$gte = new Date(startDate as string);
      }
      if (endDate) {
        filter.createdAt.$lte = new Date(endDate as string);
      }
    }

    // Busca total de documentos para paginação
    const total = await OrderModel.countDocuments(filter);

    // Busca pedidos com populate completo e paginação
    const orders = await OrderModel.find(filter)
      .populate('buyerId', 'name email phone userType companyName cpf cpfOrCnpj')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    // Para cada pedido, busca dados adicionais das emissoras
    const ordersWithDetails = await Promise.all(orders.map(async (order: any) => {
      // Extrai IDs únicos de emissoras
      const broadcasterIds: string[] = [...new Set(order.items?.map((item: any) => item.broadcasterId?.toString()).filter(Boolean))] as string[];

      // Busca dados das emissoras
      const broadcasters = await User.find({
        _id: { $in: broadcasterIds }
      }).select('companyName broadcasterProfile isCatalogOnly address').lean();

      // Mapa de emissoras por ID
      const broadcasterMap: Record<string, any> = {};
      broadcasters.forEach((b: any) => {
        broadcasterMap[b._id.toString()] = {
          name: b.broadcasterProfile?.generalInfo?.stationName || b.companyName,
          isCatalog: b.isCatalogOnly || false,
          dial: b.broadcasterProfile?.generalInfo?.dialFrequency,
          band: b.broadcasterProfile?.generalInfo?.band,
          city: b.address?.city,
          logo: b.broadcasterProfile?.generalInfo?.logoUrl
        };
      });

      // Adiciona nome da emissora a cada item
      const itemsWithBroadcasterNames = order.items?.map((item: any) => {
        const broadcaster = broadcasterMap[item.broadcasterId?.toString()];
        return {
          ...item,
          broadcasterName: broadcaster?.name || 'Emissora',
          isCatalogBroadcaster: broadcaster?.isCatalog || false,
          broadcasterDial: broadcaster?.dial,
          broadcasterBand: broadcaster?.band,
          broadcasterCity: broadcaster?.city,
          broadcasterLogo: broadcaster?.logo
        };
      });

      // Verifica se tem emissoras catálogo
      const hasCatalogBroadcasters = itemsWithBroadcasterNames?.some((item: any) => item.isCatalogBroadcaster);

      return {
        _id: order._id,
        orderNumber: order.orderNumber,
        status: order.status,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        buyer: order.buyerId,
        items: itemsWithBroadcasterNames,
        payment: order.payment,
        schedule: order.schedule,
        splits: order.splits,
        opecs: order.opecs,
        hasCatalogBroadcasters
      };
    }));


    res.json({
      orders: ordersWithDetails,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      hasMore: pageNum * limitNum < total
    });
  } catch (error) {
    console.error('❌ Erro ao buscar pedidos completos:', error);
    res.status(500).json({ error: 'Erro ao buscar pedidos' });
  }
};

/**
 * Admin aprova pedido em nome de emissoras cadastradas na plataforma
 * Credita valores nas wallets conforme splits
 */
export const adminApproveOrder = async (req: AuthRequest, res: Response) => {
  try {
    const { orderId } = req.params;


    const order = await OrderModel.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: 'Pedido não encontrado' });
    }

    // Verifica se pedido está em status que permite aprovação
    if (!['paid', 'pending_approval'].includes(order.status)) {
      return res.status(400).json({
        message: `Pedido não pode ser aprovado. Status atual: ${order.status}`
      });
    }


    // ⚠️ IMPORTANTE: Se o pagamento é "A Faturar", NÃO credita wallets agora
    if (order.payment.method === 'billing') {

      // Apenas marca como aprovado
      order.status = 'approved';
      order.approvedAt = new Date();
      await order.save();

      return res.json({
        message: 'Pedido aprovado com sucesso! Aguardando pagamento da NF para creditação.',
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
        let broadcasterWallet = await WalletModel.findOne({ userId: split.recipientId });
        if (!broadcasterWallet) {
          broadcasterWallet = await WalletModel.create({
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
          recipient: split.recipientName,
          type: 'broadcaster',
          amount: split.amount,
          status: 'credited'
        });

      } else if (split.recipientType === 'platform') {
        // Credita wallet da plataforma
        let platformWallet = await WalletModel.findOne({ userId: 'platform' });
        if (!platformWallet) {
          platformWallet = await WalletModel.create({
            userId: 'platform',
            balance: 0,
            blockedBalance: 0,
            totalEarned: 0,
            totalSpent: 0,
            transactions: []
          });
        }

        await platformWallet.addCredit(
          split.amount,
          `Pedido ${order.orderNumber} - ${split.description}`,
          order._id
        );

        creditResults.push({
          recipient: 'Plataforma',
          type: 'platform',
          amount: split.amount,
          status: 'credited'
        });

      } else if (split.recipientType === 'agency') {
        // Credita wallet da agência (se houver)
        let agencyWallet = await WalletModel.findOne({ userId: split.recipientId });
        if (!agencyWallet) {
          agencyWallet = await WalletModel.create({
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
          recipient: split.recipientName,
          type: 'agency',
          amount: split.amount,
          status: 'credited'
        });

      }
    }

    // Atualiza status do pedido
    order.status = 'approved';
    order.approvedAt = new Date();
    await order.save();


    return res.json({
      message: 'Pedido aprovado com sucesso! Valores creditados nas wallets.',
      order: {
        orderNumber: order.orderNumber,
        status: order.status
      },
      credits: creditResults
    });

  } catch (error) {
    console.error('❌ Erro ao aprovar pedido pelo admin:', error);
    return res.status(500).json({ message: 'Erro interno ao aprovar pedido' });
  }
};
/**
 * GET /api/admin/platform-wallet
 * Retorna saldo e informações da wallet da plataforma
 */
export const getPlatformWallet = async (req: AuthRequest, res: Response) => {
  try {

    let platformWallet = await WalletModel.findOne({ userId: 'platform' });

    // Cria wallet se não existir
    if (!platformWallet) {
      platformWallet = await WalletModel.create({
        userId: 'platform',
        balance: 0,
        blockedBalance: 0,
        totalEarned: 0,
        totalSpent: 0,
        transactions: []
      });
    }

    // Busca transações recentes (últimas 50)
    const recentTransactions = platformWallet.transactions
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 50);

    // Busca saldo do Asaas (para mostrar saldo real disponível para saque)
    let asaasBalance = null;
    try {
      asaasBalance = await asaasService.getAccountBalance();
    } catch (asaasError) {
      console.warn('⚠️ Não foi possível consultar saldo Asaas:', asaasError);
    }

    res.json({
      wallet: {
        balance: platformWallet.balance,
        blockedBalance: platformWallet.blockedBalance || 0,
        totalEarned: platformWallet.totalEarned,
        totalSpent: platformWallet.totalSpent || 0,
        availableBalance: platformWallet.balance - (platformWallet.blockedBalance || 0),
        bankAccount: platformWallet.bankAccount
      },
      asaasBalance: asaasBalance ? {
        balance: asaasBalance.balance,
        transferable: asaasBalance.transferable
      } : null,
      transactions: recentTransactions
    });

  } catch (error) {
    console.error('❌ Erro ao buscar wallet da plataforma:', error);
    res.status(500).json({ message: 'Erro ao buscar wallet da plataforma' });
  }
};

/**
 * PUT /api/admin/platform-wallet/bank-account
 * Atualiza dados bancários da wallet da plataforma
 */
export const updatePlatformBankAccount = async (req: AuthRequest, res: Response) => {
  try {
    const { bankCode, bankName, agency, account, accountDigit, accountType, holderName, holderDocument } = req.body;


    // Validações básicas
    if (!bankCode || !agency || !account || !holderName || !holderDocument) {
      return res.status(400).json({ message: 'Todos os campos são obrigatórios' });
    }

    let platformWallet = await WalletModel.findOne({ userId: 'platform' });

    if (!platformWallet) {
      platformWallet = await WalletModel.create({
        userId: 'platform',
        balance: 0,
        blockedBalance: 0,
        totalEarned: 0,
        totalSpent: 0,
        transactions: []
      });
    }

    platformWallet.bankAccount = {
      bankCode,
      bankName: bankName || bankCode,
      agency,
      account,
      accountDigit: accountDigit || '',
      accountType: accountType || 'checking',
      holderName,
      holderDocument
    };

    await platformWallet.save();


    res.json({
      message: 'Dados bancários atualizados com sucesso',
      bankAccount: platformWallet.bankAccount
    });

  } catch (error) {
    console.error('❌ Erro ao atualizar dados bancários:', error);
    res.status(500).json({ message: 'Erro ao atualizar dados bancários' });
  }
};

/**
 * POST /api/admin/platform-wallet/withdraw
 * Solicita saque da wallet da plataforma - INTEGRADO COM ASAAS
 */
export const requestPlatformWithdraw = async (req: AuthRequest, res: Response) => {
  try {
    const { amount, operationType = 'PIX' } = req.body;


    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Valor inválido' });
    }

    if (amount < 10) {
      return res.status(400).json({ message: 'Valor mínimo para saque: R$ 10,00' });
    }

    const platformWallet = await WalletModel.findOne({ userId: 'platform' });

    if (!platformWallet) {
      return res.status(404).json({ message: 'Wallet da plataforma não encontrada' });
    }

    // Calcula saldo disponível (total - bloqueado)
    const availableBalance = platformWallet.balance - (platformWallet.blockedBalance || 0);

    if (availableBalance < amount) {
      return res.status(400).json({
        message: `Saldo disponível insuficiente. Disponível: R$ ${availableBalance.toFixed(2)}`
      });
    }

    // Verifica se tem conta bancária cadastrada
    if (!platformWallet.bankAccount) {
      return res.status(400).json({
        message: 'Cadastre os dados bancários antes de solicitar saque'
      });
    }

    const bankAccount = platformWallet.bankAccount;

    // Verifica saldo disponível no Asaas antes de criar transferência
    const asaasBalance = await asaasService.getAccountBalance();

    if (asaasBalance.transferable < amount) {
      console.warn(`⚠️ Saldo transferível no Asaas insuficiente: R$ ${asaasBalance.transferable}`);
      return res.status(400).json({
        message: `Saldo transferível no Asaas insuficiente. Disponível para transferência: R$ ${asaasBalance.transferable.toFixed(2)}`,
        asaasBalance: asaasBalance.transferable
      });
    }

    // Cria transferência no Asaas
    const transfer = await asaasService.createTransfer({
      value: amount,
      operationType: operationType as 'PIX' | 'TED' | 'DOC',
      description: `Saque Plataforma SignalAds - ${new Date().toLocaleDateString('pt-BR')}`,
      bankAccount: {
        bank: {
          code: bankAccount.bankCode
        },
        accountName: bankAccount.holderName,
        ownerName: bankAccount.holderName,
        cpfCnpj: bankAccount.holderDocument.replace(/\D/g, ''),
        agency: bankAccount.agency,
        agencyDigit: bankAccount.agencyDigit || '',
        account: bankAccount.account,
        accountDigit: bankAccount.accountDigit || '0',
        bankAccountType: bankAccount.accountType === 'checking' ? 'CONTA_CORRENTE' : 'CONTA_POUPANCA'
      }
    });


    // Bloqueia o valor para saque
    platformWallet.blockedBalance = (platformWallet.blockedBalance || 0) + amount;

    // Adiciona transação de saque com referência do Asaas
    platformWallet.transactions.push({
      type: 'debit',
      amount,
      description: `Saque via ${operationType} - Asaas ID: ${transfer.id}`,
      relatedPaymentId: transfer.id,
      status: 'pending',
      createdAt: new Date()
    });

    await platformWallet.save();


    res.json({
      message: `Transferência ${operationType} criada com sucesso! Valor líquido: R$ ${transfer.netValue.toFixed(2)}`,
      transfer: {
        id: transfer.id,
        value: transfer.value,
        netValue: transfer.netValue,
        fee: transfer.transferFee,
        status: transfer.status,
        operationType
      },
      newAvailableBalance: platformWallet.balance - platformWallet.blockedBalance
    });

  } catch (error: any) {
    console.error('❌ Erro ao solicitar saque:', error);
    res.status(500).json({
      message: error.message || 'Erro ao solicitar saque',
      details: error.response?.data || null
    });
  }
};

/**
 * POST /api/admin/platform-wallet/confirm-withdraw
 * Confirma saque processado (marca como concluído)
 */
export const confirmPlatformWithdraw = async (req: AuthRequest, res: Response) => {
  try {
    const { amount, externalReference } = req.body;


    const platformWallet = await WalletModel.findOne({ userId: 'platform' });

    if (!platformWallet) {
      return res.status(404).json({ message: 'Wallet da plataforma não encontrada' });
    }

    // Debita do saldo e remove do bloqueado
    platformWallet.balance -= amount;
    platformWallet.blockedBalance = Math.max(0, (platformWallet.blockedBalance || 0) - amount);
    platformWallet.totalSpent = (platformWallet.totalSpent || 0) + amount;

    // Adiciona transação de saque confirmado
    platformWallet.transactions.push({
      type: 'debit',
      amount,
      description: `Saque confirmado${externalReference ? ` - Ref: ${externalReference}` : ''}`,
      status: 'completed',
      createdAt: new Date()
    });

    await platformWallet.save();


    res.json({
      message: 'Saque confirmado com sucesso',
      newBalance: platformWallet.balance
    });

  } catch (error) {
    console.error('❌ Erro ao confirmar saque:', error);
    res.status(500).json({ message: 'Erro ao confirmar saque' });
  }
};

/**
 * GET /api/admin/platform-wallet/check-transfers
 * Verifica status das transferências pendentes no Asaas e atualiza wallet
 */
export const checkPendingTransfers = async (req: AuthRequest, res: Response) => {
  try {

    const platformWallet = await WalletModel.findOne({ userId: 'platform' });

    if (!platformWallet) {
      return res.status(404).json({ message: 'Wallet da plataforma não encontrada' });
    }

    // Busca transações pendentes com ID do Asaas
    const pendingTransactions = platformWallet.transactions.filter(
      t => t.status === 'pending' && t.relatedPaymentId && t.type === 'debit'
    );

    if (pendingTransactions.length === 0) {
      return res.json({ message: 'Nenhuma transferência pendente', updated: 0 });
    }


    let updatedCount = 0;

    for (const transaction of pendingTransactions) {
      try {
        const transferStatus = await asaasService.getTransferStatus(transaction.relatedPaymentId!);


        // Atualiza status baseado no retorno do Asaas
        if (transferStatus.status === 'DONE') {
          // Transferência concluída - debita do saldo
          const txIndex = platformWallet.transactions.findIndex(
            t => t.relatedPaymentId === transaction.relatedPaymentId
          );

          if (txIndex >= 0 && platformWallet.transactions[txIndex]) {
            const tx = platformWallet.transactions[txIndex];
            tx.status = 'completed';
            tx.description = `Saque concluído - Asaas ID: ${transaction.relatedPaymentId}`;
          }

          // Debita do saldo e libera bloqueio
          platformWallet.balance -= transaction.amount;
          platformWallet.blockedBalance = Math.max(0, (platformWallet.blockedBalance || 0) - transaction.amount);
          platformWallet.totalSpent = (platformWallet.totalSpent || 0) + transaction.amount;

          updatedCount++;

        } else if (transferStatus.status === 'FAILED' || transferStatus.status === 'CANCELLED') {
          // Transferência falhou - libera o bloqueio
          const txIndex = platformWallet.transactions.findIndex(
            t => t.relatedPaymentId === transaction.relatedPaymentId
          );

          if (txIndex >= 0 && platformWallet.transactions[txIndex]) {
            const tx = platformWallet.transactions[txIndex];
            tx.status = 'failed';
            tx.description = `Saque falhou: ${transferStatus.failReason || transferStatus.status} - Asaas ID: ${transaction.relatedPaymentId}`;
          }

          // Libera o bloqueio
          platformWallet.blockedBalance = Math.max(0, (platformWallet.blockedBalance || 0) - transaction.amount);

          updatedCount++;
        }
        // Se PENDING ou BANK_PROCESSING, mantém como está

      } catch (err: any) {
        console.error(`⚠️ Erro ao verificar transferência ${transaction.relatedPaymentId}:`, err.message);
      }
    }

    if (updatedCount > 0) {
      await platformWallet.save();
    }

    res.json({
      message: `${updatedCount} transferência(s) atualizada(s)`,
      updated: updatedCount,
      total: pendingTransactions.length
    });

  } catch (error) {
    console.error('❌ Erro ao verificar transferências:', error);
    res.status(500).json({ message: 'Erro ao verificar transferências' });
  }
};

/**
 * GET /api/admin/withdraw-requests
 * Lista todas as solicitações de saque pendentes (emissoras e agências)
 */
export const getPendingWithdrawRequests = async (req: AuthRequest, res: Response) => {
  try {

    // Busca todas as wallets que têm transações de débito pendentes
    const walletsWithPendingWithdraws = await WalletModel.find({
      'transactions': {
        $elemMatch: {
          type: 'debit',
          status: 'pending'
        }
      }
    });

    const requests: any[] = [];

    for (const wallet of walletsWithPendingWithdraws) {
      // Pula a wallet da plataforma
      if (wallet.userId === 'platform') continue;

      // Busca dados do usuário
      const user = await User.findById(wallet.userId).select('fantasyName companyName email userType');

      // Filtra transações pendentes
      const pendingTransactions = wallet.transactions.filter(
        t => t.type === 'debit' && t.status === 'pending'
      );

      for (const tx of pendingTransactions) {
        requests.push({
          walletId: wallet._id,
          transactionId: (tx as any)._id,
          userId: wallet.userId,
          userName: user?.fantasyName || user?.companyName || user?.email || 'Desconhecido',
          userType: user?.userType || 'unknown',
          amount: tx.amount,
          requestedAt: tx.createdAt,
          bankAccount: wallet.bankAccount,
          walletBalance: wallet.balance,
          walletBlockedBalance: wallet.blockedBalance
        });
      }
    }

    // Ordena por data (mais antigo primeiro)
    requests.sort((a, b) => new Date(a.requestedAt).getTime() - new Date(b.requestedAt).getTime());

    res.json({
      total: requests.length,
      requests
    });

  } catch (error) {
    console.error('❌ Erro ao listar solicitações de saque:', error);
    res.status(500).json({ message: 'Erro ao listar solicitações' });
  }
};

/**
 * POST /api/admin/withdraw-requests/:walletId/:transactionId/process
 * Processa (aprova) uma solicitação de saque de emissora/agência
 * 
 * FLUXO:
 * 1. Admin aprova solicitação
 * 2. Sistema cria transferência no Asaas (da conta da plataforma para conta bancária da emissora)
 * 3. Débita valor da wallet interna da emissora
 * 4. Marca transação como completed
 */
export const processWithdrawRequest = async (req: AuthRequest, res: Response) => {
  try {
    const { walletId, transactionId } = req.params;
    const { operationType = 'PIX' } = req.body;


    // Busca wallet
    const wallet = await WalletModel.findById(walletId);
    if (!wallet) {
      return res.status(404).json({ message: 'Wallet não encontrada' });
    }

    // Busca transação
    const txIndex = wallet.transactions.findIndex(
      t => (t as any)._id?.toString() === transactionId
    );

    if (txIndex === -1) {
      return res.status(404).json({ message: 'Transação não encontrada' });
    }

    const transaction = wallet.transactions[txIndex];

    if (!transaction) {
      return res.status(404).json({ message: 'Transação não encontrada' });
    }

    if (transaction.status !== 'pending') {
      return res.status(400).json({ message: 'Transação já foi processada' });
    }

    if (transaction.type !== 'debit') {
      return res.status(400).json({ message: 'Transação não é uma solicitação de saque' });
    }

    // Verifica dados bancários
    if (!wallet.bankAccount || !wallet.bankAccount.bankCode) {
      return res.status(400).json({ message: 'Emissora não tem dados bancários cadastrados' });
    }

    const amount = transaction.amount;
    const bankAccount = wallet.bankAccount;

    // Verifica saldo disponível no Asaas
    const asaasBalance = await asaasService.getAccountBalance();

    if (asaasBalance.transferable < amount) {
      return res.status(400).json({
        message: `Saldo transferível no Asaas insuficiente. Disponível: R$ ${asaasBalance.transferable.toFixed(2)}`,
        asaasBalance: asaasBalance.transferable
      });
    }

    // Busca dados do usuário para descrição
    const user = await User.findById(wallet.userId).select('fantasyName companyName');
    const userName = user?.fantasyName || user?.companyName || 'Emissora';

    // Cria transferência no Asaas
    const transfer = await asaasService.createTransfer({
      value: amount,
      operationType: operationType as 'PIX' | 'TED',
      description: `Saque ${userName} - SignalAds`,
      bankAccount: {
        bank: { code: bankAccount.bankCode },
        accountName: bankAccount.holderName,
        ownerName: bankAccount.holderName,
        cpfCnpj: bankAccount.holderDocument.replace(/\D/g, ''),
        agency: bankAccount.agency,
        agencyDigit: bankAccount.agencyDigit || '',
        account: bankAccount.account,
        accountDigit: bankAccount.accountDigit || '0',
        bankAccountType: bankAccount.accountType === 'checking' ? 'CONTA_CORRENTE' : 'CONTA_POUPANCA'
      }
    });


    // Atualiza transação
    const tx = wallet.transactions[txIndex];
    if (tx) {
      tx.status = 'completed';
      tx.relatedPaymentId = transfer.id;
      tx.description = `Saque processado via ${operationType} - Asaas ID: ${transfer.id}`;
    }

    // Débita do saldo e libera bloqueio
    wallet.balance -= amount;
    wallet.blockedBalance = Math.max(0, (wallet.blockedBalance || 0) - amount);
    wallet.totalSpent = (wallet.totalSpent || 0) + amount;

    await wallet.save();


    res.json({
      message: `Transferência ${operationType} de R$ ${amount.toFixed(2)} processada com sucesso!`,
      transfer: {
        id: transfer.id,
        value: transfer.value,
        netValue: transfer.netValue,
        fee: transfer.transferFee,
        status: transfer.status
      }
    });

  } catch (error: any) {
    console.error('❌ Erro ao processar saque:', error);
    res.status(500).json({
      message: error.message || 'Erro ao processar saque'
    });
  }
};

/**
 * POST /api/admin/withdraw-requests/:walletId/:transactionId/reject
 * Rejeita uma solicitação de saque
 */
export const rejectWithdrawRequest = async (req: AuthRequest, res: Response) => {
  try {
    const { walletId, transactionId } = req.params;
    const { reason } = req.body;


    // Busca wallet
    const wallet = await WalletModel.findById(walletId);
    if (!wallet) {
      return res.status(404).json({ message: 'Wallet não encontrada' });
    }

    // Busca transação
    const txIndex = wallet.transactions.findIndex(
      t => (t as any)._id?.toString() === transactionId
    );

    if (txIndex === -1) {
      return res.status(404).json({ message: 'Transação não encontrada' });
    }

    const transaction = wallet.transactions[txIndex];

    if (!transaction) {
      return res.status(404).json({ message: 'Transação não encontrada' });
    }

    if (transaction.status !== 'pending') {
      return res.status(400).json({ message: 'Transação já foi processada' });
    }

    // Atualiza transação
    const tx = wallet.transactions[txIndex];
    if (tx) {
      tx.status = 'failed';
      tx.description = `Saque rejeitado: ${reason || 'Motivo não informado'}`;
    }

    // Libera bloqueio (devolve para saldo disponível)
    wallet.blockedBalance = Math.max(0, (wallet.blockedBalance || 0) - transaction.amount);

    await wallet.save();


    res.json({
      message: 'Solicitação de saque rejeitada. Valor devolvido ao saldo disponível.',
      releasedAmount: transaction?.amount || 0
    });

  } catch (error) {
    console.error('❌ Erro ao rejeitar saque:', error);
    res.status(500).json({ message: 'Erro ao rejeitar saque' });
  }
};

/**
 * PUT /api/admin/orders/:orderId/status
 * Atualiza o status de um pedido (admin)
 */
export const updateOrderStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;

    // Validate status
    const validStatuses = ['pending_contact', 'pending_payment', 'paid', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Status inválido' });
    }

    const order = await OrderModel.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: 'Pedido não encontrado' });
    }

    const oldStatus = order.status;
    order.status = status;

    // Se marcou como pago, define data
    if (status === 'paid' && oldStatus !== 'paid') {
      order.payment.status = 'received';
      order.paidAt = new Date();
    }

    await order.save();


    res.json({
      message: 'Status atualizado com sucesso',
      order: {
        _id: order._id,
        status: order.status,
        payment: order.payment
      }
    });

  } catch (error) {
    console.error('❌ Erro ao atualizar status do pedido:', error);
    res.status(500).json({ message: 'Erro ao atualizar status' });
  }
};

// ============================================================================
// GESTÃO DE USUÁRIOS (ADMIN)
// ============================================================================

/**
 * GET /api/admin/users
 * Lista todos os usuários (advertiser, agency, broadcaster, admin) com filtros e estatísticas básicas
 */
export const getAllUsers = async (req: AuthRequest, res: Response) => {
  try {
    const { page = 1, limit = 20, search, type, status } = req.query;

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.max(1, Number(limit));
    const skip = (pageNum - 1) * limitNum;

    // Filtros
    const filter: any = {};

    if (type && type !== 'all') {
      filter.userType = type;
    }

    if (status && status !== 'all') {
      filter.status = status;
    }

    if (search) {
      const searchRegex = { $regex: search, $options: 'i' };
      filter.$or = [
        { name: searchRegex },
        { email: searchRegex },
        { companyName: searchRegex },
        { fantasyName: searchRegex },
        { cpfOrCnpj: searchRegex }
      ];
    }

    // Busca total para paginação
    const total = await User.countDocuments(filter);

    // Busca usuários
    const users = await User.find(filter)
      .select('-password -twoFactorSecret')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    // Para cada usuário, buscar estatísticas básicas
    const usersWithStats = await Promise.all(users.map(async (user: any) => {
      // Pedidos do usuário (como comprador)
      const ordersCount = await OrderModel.countDocuments({ buyerId: user._id });

      // Total Gasto (pedidos pagos)
      const paidOrders = await OrderModel.find({
        buyerId: user._id,
        status: { $in: ['paid', 'approved', 'completed'] }
      }).select('payment.totalAmount');

      const totalSpent = paidOrders.reduce((sum, order) => sum + (order.payment?.totalAmount || 0), 0);

      // Carrinho
      const cart = await Cart.findOne({ userId: user._id }).select('items');
      const cartItemCount = cart?.items?.length || 0;

      return {
        ...user,
        stats: {
          ordersCount,
          totalSpent,
          cartItemCount
        }
      };
    }));

    res.json({
      users: usersWithStats,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      hasMore: pageNum * limitNum < total
    });

  } catch (error) {
    console.error('❌ Erro ao listar usuários:', error);
    res.status(500).json({ message: 'Erro ao listar usuários' });
  }
};

/**
 * GET /api/admin/users/:userId
 * Retorna detalhes completos do usuário incluindo histórico e carrinho
 */
export const getUserFullDetails = async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId).select('-password -twoFactorSecret').lean();

    if (!user) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    // Buscar Carrinho Atual
    const cart = await Cart.findOne({ userId }).lean();

    // Buscar Histórico de Pedidos
    const orders = await OrderModel.find({ buyerId: userId })
      .sort({ createdAt: -1 })
      .select('orderNumber status createdAt payment.totalAmount payment.method items')
      .lean();

    // Estatísticas Financeiras
    const paidOrders = orders.filter((o: any) => ['paid', 'approved', 'completed'].includes(o.status));
    const totalSpent = paidOrders.reduce((sum, order) => sum + (order.payment?.totalAmount || 0), 0);

    // Se for broadcaster, buscar wallet também
    let wallet = null;
    if (user.userType === 'broadcaster') {
      wallet = await WalletModel.findOne({ userId }).lean();
    }

    res.json({
      user,
      cart: cart || { items: [] },
      orders,
      stats: {
        totalOrders: orders.length,
        totalSpent,
        completedOrders: paidOrders.length
      },
      wallet
    });

  } catch (error) {
    console.error('❌ Erro ao buscar detalhes do usuário:', error);
    res.status(500).json({ message: 'Erro ao buscar detalhes' });
  }
};

/**
 * PUT /api/admin/users/:userId/status
 * Banir ou Reativar usuário
 */
export const updateUserStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params;
    const { status, reason } = req.body; // status: 'approved' | 'rejected' (rejected = banido)

    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ message: 'Status inválido' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    // Impedir banir o próprio admin
    if (req.user && req.user._id.toString() === userId) {
      return res.status(403).json({ message: 'Você não pode alterar seu próprio status' });
    }

    user.status = status;
    if (reason) user.rejectionReason = reason;

    await user.save();


    res.json({ message: 'Status atualizado com sucesso', user });

  } catch (error) {
    console.error('❌ Erro ao atualizar status do usuário:', error);
    res.status(500).json({ message: 'Erro ao atualizar status' });
  }
};

/**
 * PUT /api/admin/users/:userId/role
 * Alterar tipo de usuário (Promover a Admin / Rebaixar)
 */
export const updateUserRole = async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params;
    const { role } = req.body; // 'admin' | 'advertiser' | 'agency' | 'broadcaster'

    if (!['admin', 'advertiser', 'agency', 'broadcaster'].includes(role)) {
      return res.status(400).json({ message: 'Tipo de usuário inválido' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    // Impedir demotar o próprio admin
    if (req.user && req.user._id.toString() === userId) {
      return res.status(403).json({ message: 'Você não pode alterar seu próprio cargo' });
    }

    const oldRole = user.userType;
    user.userType = role;
    await user.save();


    res.json({ message: `Usuário alterado de ${oldRole} para ${role}`, user });

  } catch (error) {
    console.error('❌ Erro ao alterar cargo do usuário:', error);
    res.status(500).json({ message: 'Erro ao alterar cargo' });
  }
};

/**
 * PUT /api/admin/users/:userId/reset-password
 * Resetar senha do usuário (Admin)
 */
export const adminResetUserPassword = async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ message: 'Senha deve ter pelo menos 6 caracteres' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    user.password = hashedPassword;
    await user.save();


    res.json({ message: 'Senha alterada com sucesso' });

  } catch (error) {
    console.error('❌ Erro ao resetar senha do usuário:', error);
    res.status(500).json({ message: 'Erro ao resetar senha' });
  }
};