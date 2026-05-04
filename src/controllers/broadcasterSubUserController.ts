import { Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { AuthRequest } from '../middleware/auth';
import { User } from '../models/User';
import { invalidateUserCache } from '../middleware/auth';
import { sendSalesTeamInvite } from '../services/emailService';
import Proposal from '../models/Proposal';
import BroadcasterGroup from '../models/BroadcasterGroup';

// Limite default quando a emissora nao tem maxSubUsers definido pelo admin
export const DEFAULT_MAX_SUB_USERS = 3;

/**
 * Resolve o limite de sub-usuarios para uma emissora.
 * Se o manager tem maxSubUsers definido, usa esse valor; caso contrario, usa o default.
 */
async function resolveMaxSubUsers(managerId: string): Promise<number> {
  const manager = await User.findById(managerId).select('maxSubUsers').lean();
  return manager?.maxSubUsers ?? DEFAULT_MAX_SUB_USERS;
}

/**
 * Retorna o broadcasterId efetivo (para manager = req.userId, para sales = parentBroadcasterId).
 */
function getEffectiveBroadcasterId(req: AuthRequest): string | null {
  if (req.user?.userType !== 'broadcaster') return null;
  if (req.user?.broadcasterRole === 'sales') {
    return req.user?.parentBroadcasterId?.toString() || null;
  }
  return req.userId || null;
}

/**
 * Verifica se o usuario logado e o manager da emissora.
 */
function requireManager(req: AuthRequest, res: Response): boolean {
  if (req.user?.userType !== 'broadcaster') {
    res.status(403).json({ error: 'Acesso restrito a emissoras' });
    return false;
  }
  if (req.user?.broadcasterRole === 'sales') {
    res.status(403).json({ error: 'Acesso restrito ao gerenciador da emissora' });
    return false;
  }
  return true;
}

/**
 * GET /api/broadcaster/sub-users
 * Lista sub-usuarios da emissora.
 */
export const listSubUsers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireManager(req, res)) return;

    const [subUsers, maxSubUsers] = await Promise.all([
      User.find({
        parentBroadcasterId: req.userId,
        broadcasterRole: 'sales'
      })
        .select('name email phone cpfOrCnpj status createdAt emailConfirmed groupId')
        .sort({ createdAt: -1 })
        .lean(),
      resolveMaxSubUsers(req.userId!)
    ]);

    res.json({ subUsers, maxSubUsers });
  } catch (error) {
    console.error('Erro ao listar sub-usuarios:', error);
    res.status(500).json({ error: 'Erro ao listar vendedores' });
  }
};

/**
 * POST /api/broadcaster/sub-users
 * Cria um sub-usuario (vendedor) para a emissora.
 * O sub-usuario recebe email com link para definir a senha.
 */
export const createSubUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireManager(req, res)) return;

    const { name, email, phone, cpfOrCnpj } = req.body;

    // Validar campos obrigatorios
    if (!name?.trim()) {
      res.status(400).json({ error: 'Nome e obrigatorio' });
      return;
    }
    if (!email?.trim()) {
      res.status(400).json({ error: 'Email e obrigatorio' });
      return;
    }
    if (!phone?.trim()) {
      res.status(400).json({ error: 'Telefone e obrigatorio' });
      return;
    }
    if (!cpfOrCnpj?.trim()) {
      res.status(400).json({ error: 'CPF/CNPJ e obrigatorio' });
      return;
    }

    // Verificar limite de sub-usuarios (configuravel pelo admin via User.maxSubUsers)
    const [currentCount, maxSubUsers] = await Promise.all([
      User.countDocuments({
        parentBroadcasterId: req.userId,
        broadcasterRole: 'sales'
      }),
      resolveMaxSubUsers(req.userId!)
    ]);

    if (currentCount >= maxSubUsers) {
      res.status(400).json({ error: `Limite de ${maxSubUsers} vendedores atingido` });
      return;
    }

    // Verificar se email ja esta em uso
    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      res.status(400).json({ error: 'Este email ja esta em uso' });
      return;
    }

    // Gerar token de reset de senha (sub-user vai definir senha pelo link)
    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 dias

    // Senha temporaria (sera substituida pelo reset)
    const tempPassword = crypto.randomBytes(16).toString('hex');
    const hashedPassword = await bcrypt.hash(tempPassword, 12);

    const subUser = new User({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      phone: phone.trim(),
      cpfOrCnpj: cpfOrCnpj.trim(),
      password: hashedPassword,
      userType: 'broadcaster',
      broadcasterRole: 'sales',
      parentBroadcasterId: req.userId,
      status: 'approved',
      emailConfirmed: true, // Confiamos no email pois o manager informou
      passwordResetToken: resetToken,
      passwordResetTokenExpires: tokenExpires
    });

    await subUser.save();

    // Enviar email de convite
    const broadcasterName = req.user?.companyName || req.user?.fantasyName || 'Emissora';
    const inviterName = req.user?.name || req.user?.companyName || req.user?.fantasyName || 'Gerente';
    sendSalesTeamInvite(
      subUser.email,
      subUser.name || 'Vendedor',
      broadcasterName,
      inviterName,
      resetToken
    );

    res.status(201).json({
      subUser: {
        _id: subUser._id,
        name: subUser.name,
        email: subUser.email,
        phone: subUser.phone,
        cpfOrCnpj: subUser.cpfOrCnpj,
        status: subUser.status,
        createdAt: subUser.createdAt
      }
    });
  } catch (error) {
    console.error('Erro ao criar sub-usuario:', error);
    res.status(500).json({ error: 'Erro ao criar vendedor' });
  }
};

/**
 * PUT /api/broadcaster/sub-users/:id
 * Atualiza dados de um sub-usuario.
 */
export const updateSubUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireManager(req, res)) return;

    const { name, phone, cpfOrCnpj, groupId } = req.body;

    const subUser = await User.findOne({
      _id: req.params.id,
      parentBroadcasterId: req.userId,
      broadcasterRole: 'sales'
    });

    if (!subUser) {
      res.status(404).json({ error: 'Vendedor nao encontrado' });
      return;
    }

    if (name !== undefined) subUser.name = name.trim();
    if (phone !== undefined) subUser.phone = phone.trim();
    if (cpfOrCnpj !== undefined) subUser.cpfOrCnpj = cpfOrCnpj.trim();

    // Atribuir/remover grupo
    if (groupId !== undefined) {
      if (groupId === null || groupId === '') {
        subUser.groupId = undefined;
      } else {
        // Validar que o grupo pertence a esta emissora
        const group = await BroadcasterGroup.findOne({
          _id: groupId,
          broadcasterId: req.userId
        });
        if (!group) {
          res.status(400).json({ error: 'Grupo não encontrado' });
          return;
        }
        subUser.groupId = group._id;
      }
    }

    await subUser.save();
    await invalidateUserCache(subUser._id.toString());

    res.json({
      subUser: {
        _id: subUser._id,
        name: subUser.name,
        email: subUser.email,
        phone: subUser.phone,
        cpfOrCnpj: subUser.cpfOrCnpj,
        status: subUser.status,
        createdAt: subUser.createdAt,
        groupId: subUser.groupId || undefined
      }
    });
  } catch (error) {
    console.error('Erro ao atualizar sub-usuario:', error);
    res.status(500).json({ error: 'Erro ao atualizar vendedor' });
  }
};

/**
 * DELETE /api/broadcaster/sub-users/:id
 * Remove um sub-usuario.
 */
export const deleteSubUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireManager(req, res)) return;

    const subUser = await User.findOneAndDelete({
      _id: req.params.id,
      parentBroadcasterId: req.userId,
      broadcasterRole: 'sales'
    });

    if (!subUser) {
      res.status(404).json({ error: 'Vendedor nao encontrado' });
      return;
    }

    await invalidateUserCache(subUser._id.toString());

    res.json({ message: 'Vendedor removido com sucesso' });
  } catch (error) {
    console.error('Erro ao remover sub-usuario:', error);
    res.status(500).json({ error: 'Erro ao remover vendedor' });
  }
};

/**
 * POST /api/broadcaster/sub-users/:id/resend-invite
 * Reenvia email de convite (novo token de reset).
 */
export const resendInvite = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireManager(req, res)) return;

    const subUser = await User.findOne({
      _id: req.params.id,
      parentBroadcasterId: req.userId,
      broadcasterRole: 'sales'
    });

    if (!subUser) {
      res.status(404).json({ error: 'Vendedor nao encontrado' });
      return;
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    subUser.passwordResetToken = resetToken;
    subUser.passwordResetTokenExpires = tokenExpires;
    await subUser.save();

    const broadcasterName = req.user?.companyName || req.user?.fantasyName || 'Emissora';
    const inviterName = req.user?.name || req.user?.companyName || req.user?.fantasyName || 'Gerente';
    sendSalesTeamInvite(
      subUser.email,
      subUser.name || 'Vendedor',
      broadcasterName,
      inviterName,
      resetToken
    );

    res.json({ message: 'Convite reenviado com sucesso' });
  } catch (error) {
    console.error('Erro ao reenviar convite:', error);
    res.status(500).json({ error: 'Erro ao reenviar convite' });
  }
};

/**
 * GET /api/broadcaster/sub-users/stats
 * Retorna estatisticas detalhadas de propostas por sub-usuario.
 */
export const getSubUserStats = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireManager(req, res)) return;

    const [subUsers, maxSubUsers] = await Promise.all([
      User.find({
        parentBroadcasterId: req.userId,
        broadcasterRole: 'sales'
      })
        .select('name email phone cpfOrCnpj status createdAt emailConfirmed groupId')
        .sort({ createdAt: -1 })
        .lean(),
      resolveMaxSubUsers(req.userId!)
    ]);

    if (subUsers.length === 0) {
      res.json({ subUsers: [], teamTotals: { totalProposals: 0, totalSent: 0, totalApproved: 0, totalValue: 0, approvedValue: 0, conversionRate: 0 }, maxSubUsers });
      return;
    }

    const subUserIds = subUsers.map(u => u._id);

    // Aggregate proposal stats per sub-user
    const proposalStats = await Proposal.aggregate([
      {
        $match: {
          createdBy: { $in: subUserIds.map(id => new mongoose.Types.ObjectId(id.toString())) }
        }
      },
      {
        $group: {
          _id: '$createdBy',
          total: { $sum: 1 },
          draft: { $sum: { $cond: [{ $eq: ['$status', 'draft'] }, 1, 0] } },
          sent: { $sum: { $cond: [{ $eq: ['$status', 'sent'] }, 1, 0] } },
          viewed: { $sum: { $cond: [{ $eq: ['$status', 'viewed'] }, 1, 0] } },
          approved: { $sum: { $cond: [{ $in: ['$status', ['approved', 'converted']] }, 1, 0] } },
          rejected: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } },
          expired: { $sum: { $cond: [{ $eq: ['$status', 'expired'] }, 1, 0] } },
          totalValue: { $sum: { $ifNull: ['$totalAmount', 0] } },
          approvedValue: {
            $sum: {
              $cond: [
                { $in: ['$status', ['approved', 'converted']] },
                { $ifNull: ['$totalAmount', 0] },
                0
              ]
            }
          },
          lastProposalDate: { $max: '$createdAt' }
        }
      }
    ]);

    // Recent proposals per sub-user (last 5 each)
    const recentProposals = await Proposal.aggregate([
      {
        $match: {
          createdBy: { $in: subUserIds.map(id => new mongoose.Types.ObjectId(id.toString())) }
        }
      },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$createdBy',
          proposals: {
            $push: {
              _id: '$_id',
              title: '$title',
              clientName: '$clientName',
              status: '$status',
              totalAmount: '$totalAmount',
              createdAt: '$createdAt',
              sentAt: '$sentAt',
              respondedAt: '$respondedAt'
            }
          }
        }
      },
      {
        $project: {
          proposals: { $slice: ['$proposals', 5] }
        }
      }
    ]);

    // Build stats map
    const statsMap = new Map<string, any>();
    for (const stat of proposalStats) {
      statsMap.set(stat._id.toString(), stat);
    }

    const recentMap = new Map<string, any[]>();
    for (const r of recentProposals) {
      recentMap.set(r._id.toString(), r.proposals);
    }

    // Merge sub-user data with stats
    const enrichedSubUsers = subUsers.map(user => {
      const userId = user._id.toString();
      const stats = statsMap.get(userId) || {};
      const sent = (stats.sent || 0) + (stats.viewed || 0) + (stats.approved || 0) + (stats.rejected || 0) + (stats.expired || 0);
      const approved = stats.approved || 0;

      return {
        ...user,
        stats: {
          total: stats.total || 0,
          draft: stats.draft || 0,
          sent,
          approved,
          rejected: stats.rejected || 0,
          expired: stats.expired || 0,
          totalValue: stats.totalValue || 0,
          approvedValue: stats.approvedValue || 0,
          conversionRate: sent > 0 ? Math.round((approved / sent) * 100) : 0,
          lastProposalDate: stats.lastProposalDate || null
        },
        recentProposals: recentMap.get(userId) || []
      };
    });

    // Team totals
    const teamTotals = enrichedSubUsers.reduce((acc, u) => {
      acc.totalProposals += u.stats.total;
      acc.totalSent += u.stats.sent;
      acc.totalApproved += u.stats.approved;
      acc.totalValue += u.stats.totalValue;
      acc.approvedValue += u.stats.approvedValue;
      return acc;
    }, { totalProposals: 0, totalSent: 0, totalApproved: 0, totalValue: 0, approvedValue: 0, conversionRate: 0 });

    teamTotals.conversionRate = teamTotals.totalSent > 0
      ? Math.round((teamTotals.totalApproved / teamTotals.totalSent) * 100)
      : 0;

    res.json({ subUsers: enrichedSubUsers, teamTotals, maxSubUsers });
  } catch (error) {
    console.error('Erro ao buscar stats de sub-usuarios:', error);
    res.status(500).json({ error: 'Erro ao buscar estatisticas da equipe' });
  }
};

/**
 * Dashboard da equipe comercial.
 * Busca todas as propostas da emissora (por broadcasterId), agrupando por criador.
 * Inclui o proprio manager + sub-usuarios como "vendedores".
 * Query params: startDate, endDate, sellerId
 */
export const getSubUserDashboard = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireManager(req, res)) return;

    const broadcasterId = getEffectiveBroadcasterId(req);
    if (!broadcasterId) { res.status(403).json({ error: 'Acesso negado' }); return; }

    const { startDate, endDate, sellerId } = req.query as { startDate?: string; endDate?: string; sellerId?: string };

    // Fetch manager + sub-users to build the full sellers list
    const [manager, subUsers] = await Promise.all([
      User.findById(broadcasterId).select('name email status createdAt').lean(),
      User.find({ parentBroadcasterId: broadcasterId, broadcasterRole: 'sales' })
        .select('name email status createdAt').sort({ name: 1 }).lean()
    ]);

    // Build full sellers list: manager first, then sub-users
    const allSellers: any[] = manager
      ? [{ ...manager, isManager: true }, ...subUsers]
      : [...subUsers];

    // Base query: all proposals for this broadcaster
    const matchQuery: any = { broadcasterId: new mongoose.Types.ObjectId(broadcasterId) };

    // Seller filter: if a specific sellerId is given, filter by createdBy
    // Manager proposals may have createdBy = null (old) or managerId
    if (sellerId && sellerId !== 'all') {
      if (sellerId === broadcasterId) {
        // Manager's proposals: createdBy is null, undefined, or the manager's own ID
        matchQuery.$or = [
          { createdBy: null },
          { createdBy: { $exists: false } },
          { createdBy: new mongoose.Types.ObjectId(broadcasterId) }
        ];
      } else {
        matchQuery.createdBy = new mongoose.Types.ObjectId(sellerId);
      }
    }

    if (startDate || endDate) {
      matchQuery.createdAt = {};
      if (startDate) matchQuery.createdAt.$gte = new Date(startDate);
      if (endDate) { const e = new Date(endDate); e.setHours(23, 59, 59, 999); matchQuery.createdAt.$lte = e; }
    }

    const sentStatuses = ['sent', 'viewed', 'approved', 'rejected', 'expired', 'converted'];
    const approvedStatuses = ['approved', 'converted'];

    const [summaryAgg, bySellerAgg, monthlyAgg, proposals] = await Promise.all([
      Proposal.aggregate([
        { $match: matchQuery },
        { $group: { _id: null, total: { $sum: 1 }, draft: { $sum: { $cond: [{ $eq: ['$status', 'draft'] }, 1, 0] } }, sent: { $sum: { $cond: [{ $in: ['$status', sentStatuses] }, 1, 0] } }, approved: { $sum: { $cond: [{ $in: ['$status', approvedStatuses] }, 1, 0] } }, rejected: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } }, expired: { $sum: { $cond: [{ $eq: ['$status', 'expired'] }, 1, 0] } }, totalValue: { $sum: { $ifNull: ['$totalAmount', 0] } }, approvedValue: { $sum: { $cond: [{ $in: ['$status', approvedStatuses] }, { $ifNull: ['$totalAmount', 0] }, 0] } } } }
      ]),
      Proposal.aggregate([
        { $match: matchQuery },
        { $group: { _id: '$createdBy', total: { $sum: 1 }, sent: { $sum: { $cond: [{ $in: ['$status', sentStatuses] }, 1, 0] } }, approved: { $sum: { $cond: [{ $in: ['$status', approvedStatuses] }, 1, 0] } }, rejected: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } }, expired: { $sum: { $cond: [{ $eq: ['$status', 'expired'] }, 1, 0] } }, totalValue: { $sum: { $ifNull: ['$totalAmount', 0] } }, approvedValue: { $sum: { $cond: [{ $in: ['$status', approvedStatuses] }, { $ifNull: ['$totalAmount', 0] }, 0] } }, lastActivity: { $max: '$createdAt' } } }
      ]),
      Proposal.aggregate([
        { $match: matchQuery },
        { $group: { _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' }, seller: '$createdBy' }, total: { $sum: 1 }, sent: { $sum: { $cond: [{ $in: ['$status', sentStatuses] }, 1, 0] } }, approved: { $sum: { $cond: [{ $in: ['$status', approvedStatuses] }, 1, 0] } }, totalValue: { $sum: { $ifNull: ['$totalAmount', 0] } }, approvedValue: { $sum: { $cond: [{ $in: ['$status', approvedStatuses] }, { $ifNull: ['$totalAmount', 0] }, 0] } } } },
        { $sort: { '_id.year': 1, '_id.month': 1 } }
      ]),
      Proposal.find(matchQuery)
        .select('title clientName status totalAmount createdAt sentAt respondedAt validUntil createdBy')
        .sort({ createdAt: -1 }).limit(500).lean()
    ]);

    const raw = summaryAgg[0] || {};
    const summary = {
      total: raw.total || 0, draft: raw.draft || 0, sent: raw.sent || 0,
      approved: raw.approved || 0, rejected: raw.rejected || 0, expired: raw.expired || 0,
      totalValue: raw.totalValue || 0, approvedValue: raw.approvedValue || 0,
      conversionRate: (raw.sent || 0) > 0 ? Math.round(((raw.approved || 0) / raw.sent) * 100) : 0,
      avgDealValue: (raw.approved || 0) > 0 ? Math.round((raw.approvedValue || 0) / raw.approved) : 0
    };

    // sellerNameMap: manager's proposals (null/undefined createdBy) attributed to manager
    const sellerNameMap = new Map<string, string>();
    sellerNameMap.set(broadcasterId, manager?.name as string || 'Manager');
    for (const u of subUsers) sellerNameMap.set(u._id.toString(), u.name as string);

    // bySellerAgg may have _id = null for manager-created proposals (no createdBy set)
    const sellerStatsMap = new Map<string, any>();
    for (const s of bySellerAgg) {
      const key = s._id ? s._id.toString() : broadcasterId; // null → manager
      const existing = sellerStatsMap.get(key);
      if (existing) {
        existing.total += s.total; existing.sent += s.sent; existing.approved += s.approved;
        existing.rejected += s.rejected; existing.expired += s.expired;
        existing.totalValue += s.totalValue; existing.approvedValue += s.approvedValue;
      } else {
        sellerStatsMap.set(key, { ...s, conversionRate: s.sent > 0 ? Math.round((s.approved / s.sent) * 100) : 0 });
      }
    }
    // Recalculate conversionRate after merge
    for (const [k, s] of sellerStatsMap) {
      s.conversionRate = s.sent > 0 ? Math.round((s.approved / s.sent) * 100) : 0;
    }

    const bySeller = allSellers.map(u => {
      const key = u._id.toString();
      const stats = sellerStatsMap.get(key) || { total: 0, sent: 0, approved: 0, rejected: 0, expired: 0, totalValue: 0, approvedValue: 0, conversionRate: 0, lastActivity: null };
      return { _id: u._id, name: u.name, email: u.email, status: u.isManager ? 'manager' : u.status, isManager: !!u.isManager, stats };
    });

    const monthMap = new Map<string, any>();
    for (const item of monthlyAgg) {
      const key = `${item._id.year}-${String(item._id.month).padStart(2, '0')}`;
      if (!monthMap.has(key)) {
        const d = new Date(item._id.year, item._id.month - 1, 1);
        monthMap.set(key, { month: key, label: d.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }), total: 0, sent: 0, approved: 0, totalValue: 0, approvedValue: 0, bySeller: {} as Record<string, any> });
      }
      const m = monthMap.get(key)!;
      m.total += item.total; m.sent += item.sent; m.approved += item.approved;
      m.totalValue += item.totalValue; m.approvedValue += item.approvedValue;
      // null createdBy → attributed to manager
      const sId = item._id.seller ? item._id.seller.toString() : broadcasterId;
      if (!m.bySeller[sId]) m.bySeller[sId] = { total: 0, sent: 0, approved: 0, approvedValue: 0 };
      m.bySeller[sId].total += item.total; m.bySeller[sId].sent += item.sent;
      m.bySeller[sId].approved += item.approved; m.bySeller[sId].approvedValue += item.approvedValue;
    }
    const byMonth = Array.from(monthMap.values()).map(m => ({
      ...m,
      conversionRate: m.sent > 0 ? Math.round((m.approved / m.sent) * 100) : 0,
      bySeller: Object.entries(m.bySeller).map(([id, s]: [string, any]) => ({ sellerId: id, sellerName: sellerNameMap.get(id) || 'Desconhecido', ...s }))
    }));

    const enrichedProposals = (proposals as any[]).map(p => {
      const cId = p.createdBy ? p.createdBy.toString() : broadcasterId;
      return { ...p, createdByName: sellerNameMap.get(cId) || 'Desconhecido' };
    });

    const subUsersForFilter = allSellers.map(u => ({ _id: u._id, name: u.name, status: u.isManager ? 'manager' : u.status, isManager: !!u.isManager }));

    res.json({ summary, bySeller, byMonth, proposals: enrichedProposals, subUsers: subUsersForFilter });
  } catch (error) {
    console.error('Erro ao buscar dashboard da equipe:', error);
    res.status(500).json({ error: 'Erro ao buscar dados do dashboard' });
  }
};

export { getEffectiveBroadcasterId };
