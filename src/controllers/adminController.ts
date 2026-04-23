import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { User } from '../models/User';
import { cacheInvalidate } from '../config/redis';
import { invalidateUserCache } from '../middleware/auth';
import OrderModel, { IOrder } from '../models/Order';
import { AuthRequest } from '../middleware/auth';
import { escapeRegex } from '../utils/stringUtils';
import { Cart } from '../models/Cart';
import bcrypt from 'bcryptjs';
import { revokeAllUserTokens } from '../utils/tokenService';
import QuoteRequest from '../models/QuoteRequest';
import { PLATFORM_COMMISSION_RATE } from '../models/Product';
import {
  sendOrderPendingPaymentToClient,
  sendOrderPaidConfirmedToClient,
  sendOrderInProductionToClient,
  sendOrderCancelledByAdminToClient,
  sendNewOrderToAdmin,
  sendOrderReceivedToClient
} from '../services/emailService';

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

    // Invalida caches do marketplace/mapa/comparador (nova emissora aprovada)
    // + cache de auth do usuario (status mudou)
    await Promise.all([
      cacheInvalidate('marketplace:*'),
      cacheInvalidate('map:*'),
      cacheInvalidate('compare:*'),
      invalidateUserCache(broadcaster._id.toString()),
    ]);

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

    // Invalida caches (emissora removida do marketplace)
    // + cache de auth do usuario (status mudou)
    await Promise.all([
      cacheInvalidate('marketplace:*'),
      cacheInvalidate('map:*'),
      cacheInvalidate('compare:*'),
      invalidateUserCache(broadcaster._id.toString()),
    ]);

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
      const safeSearch = escapeRegex(search as string);
      filter.$or = [
        { companyName: { $regex: safeSearch, $options: 'i' } },
        { email: { $regex: safeSearch, $options: 'i' } },
        { 'broadcasterProfile.generalInfo.stationName': { $regex: safeSearch, $options: 'i' } }
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

    res.json({
      total,
      hasMore: pageNum * limitNum < total,
      totalPages: Math.ceil(total / limitNum),
      broadcasters
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar emissoras' });
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
    res.status(500).json({ error: 'Erro ao buscar detalhes da emissora' });
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

    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 25));
    const skip = (pageNum - 1) * limitNum;

    // Monta filtro base — exclui pedidos internos de emissora
    // (propostas aprovadas que viraram campanha sem envolvimento da plataforma)
    const filter: any = { isFromBroadcasterProposal: { $ne: true } };

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

    // Paraleliza count + find (queries independentes)
    const [total, orders] = await Promise.all([
      OrderModel.countDocuments(filter),
      OrderModel.find(filter)
        .populate('buyerId', 'name email phone userType companyName cpf cpfOrCnpj')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean()
    ]);

    // Batch: coleta TODOS os broadcasterIds de TODOS os pedidos em uma única query
    const allBroadcasterIds = [...new Set(
      orders.flatMap((o: any) => o.items?.map((i: any) => i.broadcasterId?.toString()).filter(Boolean) || [])
    )];

    const allBroadcasters = await User.find({
      _id: { $in: allBroadcasterIds }
    }).select('companyName broadcasterProfile isCatalogOnly address').lean();

    // Mapa global de emissoras (1 lookup por ID ao invés de N queries)
    const broadcasterMap: Record<string, any> = {};
    allBroadcasters.forEach((b: any) => {
      broadcasterMap[b._id.toString()] = {
        name: b.broadcasterProfile?.generalInfo?.stationName || b.companyName,
        isCatalog: b.isCatalogOnly || false,
        dial: b.broadcasterProfile?.generalInfo?.dialFrequency,
        band: b.broadcasterProfile?.generalInfo?.band,
        city: b.address?.city,
        logo: b.broadcasterProfile?.logo
      };
    });

    // Mapeia pedidos usando o mapa global (0 queries adicionais)
    const ordersWithDetails = orders.map((order: any) => {
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

      const hasCatalogBroadcasters = itemsWithBroadcasterNames?.some((item: any) => item.isCatalogBroadcaster);

      // Recalcula valores financeiros a partir dos itens (corrige pedidos com valores legados no DB)
      const grossFromItems = Math.round(
        (itemsWithBroadcasterNames || []).reduce((sum: number, item: any) => sum + (item.totalPrice || 0), 0) * 100
      ) / 100;
      const broadcasterAmountCalc = Math.round((grossFromItems / (1 + PLATFORM_COMMISSION_RATE)) * 100) / 100;
      const platformSplitCalc = Math.round((grossFromItems - broadcasterAmountCalc) * 100) / 100;

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
        hasCatalogBroadcasters,
        isMonitoringEnabled: order.isMonitoringEnabled,
        monitoringCost: order.monitoringCost,
        agencyCommission: order.agencyCommission,
        grossAmount: grossFromItems,
        broadcasterAmount: broadcasterAmountCalc,
        platformSplit: platformSplitCalc,
        techFee: order.techFee,
        totalAmount: order.totalAmount,
      };
    });


    res.json({
      orders: ordersWithDetails,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      hasMore: pageNum * limitNum < total
    });
  } catch (error) {
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

    // Atualiza status do pedido
    order.status = 'approved';
    order.approvedAt = new Date();
    await order.save();

    // 📧 Email para o cliente: campanha em produção
    setImmediate(async () => {
      try {
        // Conta emissoras únicas nos splits
        const broadcasterCount = new Set(
          order.splits.filter(s => s.recipientType === 'broadcaster').map(s => s.recipientId)
        ).size;

        await sendOrderInProductionToClient({
          orderNumber: order.orderNumber,
          buyerName: order.buyerName,
          buyerEmail: order.buyerEmail,
          totalValue: order.totalAmount,
          broadcasterCount: broadcasterCount || 1
        });
      } catch (emailErr) {
        // Email error silenced in production
      }
    });

    return res.json({
      message: 'Pedido aprovado com sucesso!',
      order: {
        orderNumber: order.orderNumber,
        status: order.status
      }
    });

  } catch (error) {
    return res.status(500).json({ message: 'Erro interno ao aprovar pedido' });
  }
};
/**
 * PUT /api/admin/orders/:orderId/status
 * Atualiza o status de um pedido (admin)
 */
export const updateOrderStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { orderId } = req.params;
    const { status, cancellationReason } = req.body;

    // Validate status
    const validStatuses = ['pending_contact', 'pending_payment', 'paid', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Status inválido' });
    }

    const order = await OrderModel.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: 'Pedido não encontrado' });
    }

    // State machine: transicoes validas (#48)
    const validTransitions: Record<string, string[]> = {
      pending_contact: ['pending_payment', 'cancelled'],
      pending_payment: ['paid', 'cancelled'],
      paid: ['cancelled'],
      cancelled: [],
    };
    const oldStatus = order.status;
    const allowed = validTransitions[oldStatus] || [];
    if (!allowed.includes(status)) {
      return res.status(400).json({ message: `Transição inválida: ${oldStatus} → ${status}` });
    }

    order.status = status;

    // Se marcou como pago, define data
    if (status === 'paid' && oldStatus !== 'paid') {
      order.payment.status = 'received';
      order.paidAt = new Date();
    }

    // Se cancelou, salva motivo e data
    if (status === 'cancelled') {
      order.cancelledAt = new Date();
      if (cancellationReason) {
        order.cancellationReason = cancellationReason;
      }
    }

    await order.save();

    // 📧 Dispara email de notificação ao cliente conforme a transição de status
    setImmediate(async () => {
      try {
        if (status === 'pending_payment' && oldStatus !== 'pending_payment') {
          await sendOrderPendingPaymentToClient({
            orderNumber: order.orderNumber,
            buyerName: order.buyerName,
            buyerEmail: order.buyerEmail,
            totalValue: order.totalAmount
          });
        }

        if (status === 'paid' && oldStatus !== 'paid') {
          await sendOrderPaidConfirmedToClient({
            orderNumber: order.orderNumber,
            buyerName: order.buyerName,
            buyerEmail: order.buyerEmail,
            totalValue: order.totalAmount
          });
        }

        if (status === 'cancelled' && oldStatus !== 'cancelled') {
          await sendOrderCancelledByAdminToClient({
            orderNumber: order.orderNumber,
            buyerName: order.buyerName,
            buyerEmail: order.buyerEmail,
            totalValue: order.totalAmount,
            reason: cancellationReason
          });
        }
      } catch (emailErr) {
        // Email error silenced in production
      }
    });

    res.json({
      message: 'Status atualizado com sucesso',
      order: {
        _id: order._id,
        status: order.status,
        payment: order.payment
      }
    });

  } catch (error) {
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
    const filter: any = { emailConfirmed: true };

    if (type && type !== 'all') {
      filter.userType = type;
    }

    if (status && status !== 'all') {
      filter.status = status;
    }

    if (search) {
      const searchRegex = { $regex: escapeRegex(search as string), $options: 'i' };
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

    const userIds = users.map(u => u._id);

    // 1. Buscar carrinhos de uma vez só
    const carts = await Cart.find({ userId: { $in: userIds } }).select('userId items').lean();
    const cartMap = new Map();
    carts.forEach((c: any) => cartMap.set(c.userId.toString(), c.items?.length || 0));

    // 2. Buscar status de pedidos (contagem e valor gasto) agrupado por comprador
    const orderStats = await OrderModel.aggregate([
      { $match: { buyerId: { $in: userIds } } },
      {
        $group: {
          _id: '$buyerId',
          ordersCount: { $sum: 1 },
          totalSpent: {
            $sum: {
              $cond: [
                { $in: ['$status', ['paid', 'approved', 'completed']] },
                { $ifNull: ['$payment.totalAmount', 0] },
                0
              ]
            }
          }
        }
      }
    ]);

    const statsMap = new Map();
    orderStats.forEach(stat => {
      statsMap.set(stat._id.toString(), {
        ordersCount: stat.ordersCount,
        totalSpent: stat.totalSpent
      });
    });

    // Para cada usuário, associar os dados já carregados
    const usersWithStats = users.map((user: any) => {
      const uId = user._id.toString();
      const stats = statsMap.get(uId) || { ordersCount: 0, totalSpent: 0 };
      const cartItemCount = cartMap.get(uId) || 0;

      return {
        ...user,
        stats: {
          ordersCount: stats.ordersCount,
          totalSpent: stats.totalSpent,
          cartItemCount
        }
      };
    });

    res.json({
      users: usersWithStats,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      hasMore: pageNum * limitNum < total
    });

  } catch (error) {
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

    res.json({
      user,
      cart: cart || { items: [] },
      orders,
      stats: {
        totalOrders: orders.length,
        totalSpent,
        completedOrders: paidOrders.length
      }
    });

  } catch (error) {
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

    // Invalida cache de auth (status/permissoes do usuario mudaram)
    await invalidateUserCache(user._id.toString());

    res.json({ message: 'Status atualizado com sucesso', user });

  } catch (error) {
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

    // Invalida cache de auth (role do usuario mudou — CRITICO para seguranca)
    await invalidateUserCache(user._id.toString());

    res.json({ message: `Usuário alterado de ${oldRole} para ${role}`, user });

  } catch (error) {
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

    if (!newPassword) {
      return res.status(400).json({ message: 'Nova senha é obrigatória' });
    }
    // Mesma validacao de forca usada em todo o sistema
    if (newPassword.length < 10) return res.status(400).json({ message: 'Senha deve ter no mínimo 10 caracteres' });
    if (!/[A-Z]/.test(newPassword)) return res.status(400).json({ message: 'Senha deve conter ao menos uma letra maiúscula' });
    if (!/[a-z]/.test(newPassword)) return res.status(400).json({ message: 'Senha deve conter ao menos uma letra minúscula' });
    if (!/[0-9]/.test(newPassword)) return res.status(400).json({ message: 'Senha deve conter ao menos um número' });
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(newPassword)) return res.status(400).json({ message: 'Senha deve conter ao menos um caractere especial' });

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    user.password = hashedPassword;
    await user.save();

    // Invalida cache de auth
    await invalidateUserCache(user._id.toString());

    // Revoga todas as sessoes ativas do usuario — impede uso de tokens roubados
    await revokeAllUserTokens(user._id.toString());

    res.json({ message: 'Senha alterada com sucesso' });

  } catch (error) {
    res.status(500).json({ message: 'Erro ao resetar senha' });
  }
};

/**
 * DELETE /api/admin/users/:userId
 * Exclusão DEFINITIVA de conta e todos os dados do usuário.
 * Usado para atender pedidos formais de exclusão (LGPD / Política de Privacidade).
 */
export const deleteUser = async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ message: 'userId é obrigatório' });
    }

    // Proteção: admin não pode excluir a si mesmo
    if (req.user && req.user._id.toString() === userId) {
      return res.status(403).json({ message: 'Você não pode excluir sua própria conta' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    // Proteção extra: não excluir outros admins sem confirmação
    if (user.userType === 'admin') {
      return res.status(403).json({ message: 'Não é possível excluir contas de administrador por esta rota' });
    }

    const deletionSummary: Record<string, number> = {};

    // 1. Carrinhos do usuário
    const cartResult = await Cart.deleteMany({ userId });
    deletionSummary.carts = cartResult.deletedCount;

    // 2. Pedidos como comprador (mantemos registro para auditoria financeira,
    //    mas removemos referência ao usuário — anonimização)
    const orderUpdateResult = await OrderModel.updateMany(
      { buyerId: userId },
      { $set: { buyerId: null, buyerAnonymized: true } }
    );
    deletionSummary.ordersAnonymized = orderUpdateResult.modifiedCount;

    // 3. Quote Requests (solicitações de orçamento)
    const quoteResult = await QuoteRequest.deleteMany({ buyer: userId });
    deletionSummary.quoteRequests = quoteResult.deletedCount;

    // 6. Remove usuário de favoritos de outros usuários
    await User.updateMany(
      { favorites: userId },
      { $pull: { favorites: userId } }
    );

    // 7. Finalmente, excluir o usuário
    await User.findByIdAndDelete(userId);

    res.json({
      message: 'Conta e dados do usuário excluídos definitivamente.',
      deletedUser: {
        id: userId,
        email: user.email,
        userType: user.userType
      },
      summary: deletionSummary
    });

  } catch (error) {
    res.status(500).json({ message: 'Erro ao excluir conta do usuário' });
  }
};

/**
 * POST /api/admin/orders/:orderId/items/:itemIndex/upload-recording-audio
 * Admin faz upload do áudio gravado para um item com tipo 'recording'.
 * Converte o material do item de 'recording' para 'audio' com a URL do arquivo no bucket.
 */
export const adminUploadRecordingAudio = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { orderId, itemIndex } = req.params;
    const { audioDuration } = req.body;

    if (!req.file) {
      res.status(400).json({ error: 'Arquivo de áudio não enviado' });
      return;
    }

    const order = await OrderModel.findById(orderId);
    if (!order) {
      res.status(404).json({ error: 'Pedido não encontrado' });
      return;
    }

    const idx = parseInt(itemIndex as string, 10);
    const item = order.items[idx];

    if (!item) {
      res.status(404).json({ error: 'Item não encontrado no pedido' });
      return;
    }

    if (item.material?.type !== 'recording') {
      res.status(400).json({ error: 'Este item não possui solicitação de gravação pendente' });
      return;
    }

    const { uploadFile } = await import('../config/storage');

    // Upload do áudio para o bucket
    const audioUrl = await uploadFile(
      req.file.buffer,
      req.file.originalname,
      'audio',
      req.file.mimetype
    );

    const parsedDuration = audioDuration ? parseFloat(audioDuration) : undefined;

    // Indices adicionais para aplicar o mesmo áudio (opcional)
    const applyToItems: number[] = req.body.applyToItems
      ? JSON.parse(req.body.applyToItems)
      : [];

    // Coleta todos os indices a atualizar (item principal + extras)
    const allIndices = [idx, ...applyToItems.map(i => parseInt(String(i), 10))];
    const uniqueIndices = [...new Set(allIndices)];

    for (const targetIdx of uniqueIndices) {
      const targetItem = order.items[targetIdx];
      if (!targetItem || targetItem.material?.type !== 'recording') continue;

      const previousScript = targetItem.material.script;
      const previousVoiceGender = targetItem.material.voiceGender;
      const previousMusicStyle = targetItem.material.musicStyle;
      const previousPhonetic = targetItem.material.phonetic;
      const existingChat = targetItem.material.chat || [];

      targetItem.material = {
        type: 'audio',
        audioUrl,
        audioFileName: req.file.originalname,
        audioDuration: parsedDuration,
        script: previousScript,
        phonetic: previousPhonetic,
        voiceGender: previousVoiceGender,
        musicStyle: previousMusicStyle,
        status: 'final_approved',
        chat: [
          ...existingChat,
          {
            sender: 'broadcaster' as const,
            message: 'Áudio gravado enviado pelo administrador da plataforma.',
            fileUrl: audioUrl,
            fileName: req.file.originalname,
            action: 'uploaded' as const,
            timestamp: new Date(),
          },
        ],
      } as any;
    }

    // Marca o array como modificado para o Mongoose detectar alterações em múltiplos subdocuments
    order.markModified('items');
    await order.save();

    res.json({
      success: true,
      audioUrl,
      audioFileName: req.file.originalname,
      audioDuration: parsedDuration,
      updatedItems: uniqueIndices.length,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Erro ao fazer upload do áudio' });
  }
};

/**
 * DELETE /api/admin/orders/:orderId/items/:itemIndex/recording-audio
 * Reverte o material de 'audio' para 'recording', removendo o áudio enviado.
 */
export const adminDeleteRecordingAudio = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { orderId, itemIndex } = req.params;

    const order = await OrderModel.findById(orderId);
    if (!order) {
      res.status(404).json({ error: 'Pedido não encontrado' });
      return;
    }

    const idx = parseInt(itemIndex as string, 10);
    const item = order.items[idx];

    if (!item) {
      res.status(404).json({ error: 'Item não encontrado no pedido' });
      return;
    }

    if (item.material?.type !== 'audio') {
      res.status(400).json({ error: 'Este item não possui áudio para remover' });
      return;
    }

    // Reverte para tipo 'recording' preservando dados do roteiro
    item.material = {
      type: 'recording',
      script: item.material.script,
      phonetic: item.material.phonetic,
      voiceGender: item.material.voiceGender,
      musicStyle: item.material.musicStyle,
      chat: item.material.chat || [],
    } as any;

    order.markModified('items');
    await order.save();

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Erro ao remover áudio' });
  }
};