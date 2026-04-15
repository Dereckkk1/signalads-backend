import { Request, Response } from 'express';
import mongoose from 'mongoose';
import Proposal from '../models/Proposal';
import Goal from '../models/Goal';
import { User, IUser } from '../models/User';
import AgencyClient from '../models/AgencyClient';

interface AuthRequest extends Request {
  user?: any;
  userId?: string;
}

function getManagerId(req: AuthRequest): string {
  if (req.user?.broadcasterRole === 'sales') {
    return req.user?.parentBroadcasterId?.toString() || '';
  }
  return req.userId!;
}

async function getAllBroadcasterIds(managerId: string): Promise<mongoose.Types.ObjectId[]> {
  const subUsers = await User.find(
    { parentBroadcasterId: managerId, userType: 'broadcaster' },
    { _id: 1 }
  );
  return [
    new mongoose.Types.ObjectId(managerId),
    ...subUsers.map((u: IUser) => u._id as mongoose.Types.ObjectId),
  ];
}

function buildBaseMatch(
  broadcasterIds: mongoose.Types.ObjectId[],
  req: AuthRequest,
  managerId: string
) {
  const { startDate, endDate, sellerId, dateField } = req.query as {
    startDate?: string;
    endDate?: string;
    sellerId?: string;
    dateField?: string;
  };

  const field = ['createdAt', 'sentAt', 'respondedAt'].includes(dateField || '')
    ? dateField!
    : 'createdAt';

  const match: any = { broadcasterId: { $in: broadcasterIds } };

  // Sales users only see their own proposals
  const isSales = req.user?.broadcasterRole === 'sales';
  if (isSales) {
    match.createdBy = new mongoose.Types.ObjectId(req.userId!);
  } else if (sellerId && sellerId !== 'all') {
    if (sellerId === managerId) {
      match.$or = [
        { createdBy: null },
        { createdBy: { $exists: false } },
        { createdBy: new mongoose.Types.ObjectId(managerId) },
      ];
    } else {
      match.createdBy = new mongoose.Types.ObjectId(sellerId);
    }
  }

  if (startDate || endDate) {
    match[field] = {};
    if (startDate) match[field].$gte = new Date(startDate);
    if (endDate) {
      const e = new Date(endDate);
      e.setHours(23, 59, 59, 999);
      match[field].$lte = e;
    }
  }

  return match;
}

const SENT_STATUSES = ['sent', 'viewed', 'approved', 'rejected', 'expired', 'converted'];
const APPROVED_STATUSES = ['approved', 'converted'];

// GET /api/broadcaster/reports/summary
export const getSummary = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (req.user?.userType !== 'broadcaster') {
      res.status(403).json({ error: 'Acesso restrito a emissoras' });
      return;
    }

    const managerId = getManagerId(req);
    const broadcasterIds = await getAllBroadcasterIds(managerId);
    const match = buildBaseMatch(broadcasterIds, req, managerId);

    const [summaryAgg, topClientsAgg, topSellersAgg, monthlyAgg, manager, subUsers] =
      await Promise.all([
        Proposal.aggregate([
          { $match: match },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              draft: { $sum: { $cond: [{ $eq: ['$status', 'draft'] }, 1, 0] } },
              sent: { $sum: { $cond: [{ $in: ['$status', SENT_STATUSES] }, 1, 0] } },
              approved: { $sum: { $cond: [{ $in: ['$status', APPROVED_STATUSES] }, 1, 0] } },
              rejected: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } },
              expired: { $sum: { $cond: [{ $eq: ['$status', 'expired'] }, 1, 0] } },
              totalValue: { $sum: { $ifNull: ['$totalAmount', 0] } },
              approvedValue: {
                $sum: {
                  $cond: [
                    { $in: ['$status', APPROVED_STATUSES] },
                    { $ifNull: ['$totalAmount', 0] },
                    0,
                  ],
                },
              },
            },
          },
        ]),
        Proposal.aggregate([
          { $match: match },
          {
            $group: {
              _id: '$clientName',
              count: { $sum: 1 },
              totalValue: { $sum: { $ifNull: ['$totalAmount', 0] } },
              approvedValue: {
                $sum: {
                  $cond: [
                    { $in: ['$status', APPROVED_STATUSES] },
                    { $ifNull: ['$totalAmount', 0] },
                    0,
                  ],
                },
              },
              approvedCount: {
                $sum: { $cond: [{ $in: ['$status', APPROVED_STATUSES] }, 1, 0] },
              },
            },
          },
          { $sort: { approvedValue: -1 } },
          { $limit: 5 },
        ]),
        Proposal.aggregate([
          { $match: match },
          {
            $group: {
              _id: '$createdBy',
              count: { $sum: 1 },
              totalValue: { $sum: { $ifNull: ['$totalAmount', 0] } },
              approvedValue: {
                $sum: {
                  $cond: [
                    { $in: ['$status', APPROVED_STATUSES] },
                    { $ifNull: ['$totalAmount', 0] },
                    0,
                  ],
                },
              },
              approvedCount: {
                $sum: { $cond: [{ $in: ['$status', APPROVED_STATUSES] }, 1, 0] },
              },
            },
          },
          { $sort: { approvedValue: -1 } },
          { $limit: 5 },
        ]),
        Proposal.aggregate([
          { $match: match },
          {
            $group: {
              _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
              total: { $sum: 1 },
              approved: { $sum: { $cond: [{ $in: ['$status', APPROVED_STATUSES] }, 1, 0] } },
              totalValue: { $sum: { $ifNull: ['$totalAmount', 0] } },
              approvedValue: {
                $sum: {
                  $cond: [
                    { $in: ['$status', APPROVED_STATUSES] },
                    { $ifNull: ['$totalAmount', 0] },
                    0,
                  ],
                },
              },
            },
          },
          { $sort: { '_id.year': 1, '_id.month': 1 } },
        ]),
        User.findById(managerId, { name: 1 }).lean(),
        User.find(
          { parentBroadcasterId: managerId, userType: 'broadcaster' },
          { _id: 1, name: 1 }
        ).lean(),
      ]);

    const sellerNameMap = new Map<string, string>([
      [managerId, (manager as any)?.name ?? 'Gerente'],
      ...subUsers.map((u: any) => [u._id.toString(), u.name] as [string, string]),
    ]);

    const raw = summaryAgg[0] || {};
    const summary = {
      total: raw.total || 0,
      draft: raw.draft || 0,
      sent: raw.sent || 0,
      approved: raw.approved || 0,
      rejected: raw.rejected || 0,
      expired: raw.expired || 0,
      totalValue: raw.totalValue || 0,
      approvedValue: raw.approvedValue || 0,
      conversionRate:
        (raw.sent || 0) > 0 ? Math.round(((raw.approved || 0) / raw.sent) * 100) : 0,
      avgDealValue:
        (raw.approved || 0) > 0
          ? Math.round((raw.approvedValue || 0) / raw.approved)
          : 0,
    };

    const topClients = topClientsAgg.map((c) => ({
      label: c._id || 'Sem nome',
      count: c.count,
      approvedCount: c.approvedCount,
      totalValue: c.totalValue,
      approvedValue: c.approvedValue,
      conversionRate:
        c.count > 0 ? Math.round((c.approvedCount / c.count) * 100) : 0,
    }));

    const topSellers = topSellersAgg.map((s) => {
      const key = s._id ? s._id.toString() : managerId;
      return {
        label: sellerNameMap.get(key) ?? 'Desconhecido',
        count: s.count,
        approvedCount: s.approvedCount,
        totalValue: s.totalValue,
        approvedValue: s.approvedValue,
        conversionRate:
          s.count > 0 ? Math.round((s.approvedCount / s.count) * 100) : 0,
      };
    });

    const byMonth = monthlyAgg.map((m) => {
      const d = new Date(m._id.year, m._id.month - 1, 1);
      return {
        month: `${m._id.year}-${String(m._id.month).padStart(2, '0')}`,
        label: d.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }),
        total: m.total,
        approved: m.approved,
        totalValue: m.totalValue,
        approvedValue: m.approvedValue,
      };
    });

    // Available sellers for filter
    const allSellers = [
      { _id: managerId, name: (manager as any)?.name ?? 'Gerente', isManager: true },
      ...subUsers.map((u: any) => ({ _id: u._id.toString(), name: u.name, isManager: false })),
    ];

    res.json({ summary, topClients, topSellers, byMonth, sellers: allSellers });
  } catch (err) {
    console.error('getSummary error:', err);
    res.status(500).json({ error: 'Erro ao buscar resumo' });
  }
};

// GET /api/broadcaster/reports/breakdown?by=...
export const getBreakdown = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (req.user?.userType !== 'broadcaster') {
      res.status(403).json({ error: 'Acesso restrito a emissoras' });
      return;
    }

    const { by } = req.query as { by?: string };
    if (!by) {
      res.status(400).json({ error: 'Parâmetro "by" é obrigatório' });
      return;
    }

    const managerId = getManagerId(req);
    const broadcasterIds = await getAllBroadcasterIds(managerId);
    const match = buildBaseMatch(broadcasterIds, req, managerId);

    let rows: any[] = [];

    // Helper to compute approvedValue / conversionRate from aggregate results
    const buildRow = (label: string, r: any) => ({
      label: label || 'Sem dado',
      count: r.count || 0,
      approvedCount: r.approvedCount || 0,
      totalValue: r.totalValue || 0,
      approvedValue: r.approvedValue || 0,
      conversionRate:
        (r.count || 0) > 0 ? Math.round(((r.approvedCount || 0) / r.count) * 100) : 0,
    });

    const groupFields = {
      count: { $sum: 1 },
      approvedCount: { $sum: { $cond: [{ $in: ['$status', APPROVED_STATUSES] }, 1, 0] } },
      totalValue: { $sum: { $ifNull: ['$totalAmount', 0] } },
      approvedValue: {
        $sum: {
          $cond: [
            { $in: ['$status', APPROVED_STATUSES] },
            { $ifNull: ['$totalAmount', 0] },
            0,
          ],
        },
      },
    };

    switch (by) {
      case 'client': {
        const agg = await Proposal.aggregate([
          { $match: match },
          { $group: { _id: '$clientName', ...groupFields } },
          { $sort: { approvedValue: -1 } },
        ]);
        rows = agg.map((r) => buildRow(r._id, r));
        break;
      }

      case 'seller': {
        const [agg, managerUser, subUsers] = await Promise.all([
          Proposal.aggregate([
            { $match: match },
            { $group: { _id: '$createdBy', ...groupFields } },
            { $sort: { approvedValue: -1 } },
          ]),
          User.findById(managerId, { name: 1 }).lean(),
          User.find(
            { parentBroadcasterId: managerId, userType: 'broadcaster' },
            { _id: 1, name: 1 }
          ).lean(),
        ]);
        const nm = new Map<string, string>([
          [managerId, (managerUser as any)?.name ?? 'Gerente'],
          ...subUsers.map((u: any) => [u._id.toString(), u.name] as [string, string]),
        ]);
        rows = agg.map((r) => {
          const key = r._id ? r._id.toString() : managerId;
          return buildRow(nm.get(key) ?? 'Desconhecido', r);
        });
        break;
      }

      case 'insertionType': {
        const agg = await Proposal.aggregate([
          { $match: match },
          { $unwind: { path: '$items', preserveNullAndEmptyArrays: true } },
          {
            $group: {
              _id: '$items.productType',
              count: { $sum: 1 },
              approvedCount: {
                $sum: { $cond: [{ $in: ['$status', APPROVED_STATUSES] }, 1, 0] },
              },
              totalValue: { $sum: { $ifNull: ['$items.totalPrice', 0] } },
              approvedValue: {
                $sum: {
                  $cond: [
                    { $in: ['$status', APPROVED_STATUSES] },
                    { $ifNull: ['$items.totalPrice', 0] },
                    0,
                  ],
                },
              },
            },
          },
          { $sort: { totalValue: -1 } },
        ]);
        rows = agg.map((r) => buildRow(r._id, r));
        break;
      }

      case 'clientType':
      case 'group': {
        // Join Proposal → AgencyClient → ClientType
        const agg = await Proposal.aggregate([
          { $match: { ...match, clientId: { $exists: true, $ne: null } } },
          {
            $lookup: {
              from: 'agencyclients',
              localField: 'clientId',
              foreignField: '_id',
              as: 'clientData',
            },
          },
          { $unwind: { path: '$clientData', preserveNullAndEmptyArrays: true } },
          {
            $lookup: {
              from: 'clienttypes',
              localField: 'clientData.clientTypeId',
              foreignField: '_id',
              as: 'clientTypeData',
            },
          },
          { $unwind: { path: '$clientTypeData', preserveNullAndEmptyArrays: true } },
          {
            $group: {
              _id: { $ifNull: ['$clientTypeData.name', 'Sem tipo'] },
              ...groupFields,
            },
          },
          { $sort: { approvedValue: -1 } },
        ]);
        rows = agg.map((r) => buildRow(r._id, r));
        break;
      }

      case 'proposalType': {
        const agg = await Proposal.aggregate([
          { $match: match },
          { $unwind: { path: '$items', preserveNullAndEmptyArrays: true } },
          {
            $group: {
              _id: '$items.itemType',
              count: { $sum: 1 },
              approvedCount: {
                $sum: { $cond: [{ $in: ['$status', APPROVED_STATUSES] }, 1, 0] },
              },
              totalValue: { $sum: { $ifNull: ['$items.totalPrice', 0] } },
              approvedValue: {
                $sum: {
                  $cond: [
                    { $in: ['$status', APPROVED_STATUSES] },
                    { $ifNull: ['$items.totalPrice', 0] },
                    0,
                  ],
                },
              },
            },
          },
          { $sort: { totalValue: -1 } },
        ]);
        const typeLabel: Record<string, string> = {
          product: 'Produto/Spot',
          sponsorship: 'Patrocínio',
        };
        rows = agg.map((r) => buildRow(typeLabel[r._id] ?? r._id, r));
        break;
      }

      case 'userType': {
        const agg = await Proposal.aggregate([
          { $match: match },
          {
            $lookup: {
              from: 'users',
              localField: 'createdBy',
              foreignField: '_id',
              as: 'creatorData',
            },
          },
          { $unwind: { path: '$creatorData', preserveNullAndEmptyArrays: true } },
          {
            $group: {
              _id: { $ifNull: ['$creatorData.broadcasterRole', 'manager'] },
              ...groupFields,
            },
          },
          { $sort: { count: -1 } },
        ]);
        const roleLabel: Record<string, string> = {
          manager: 'Gerente',
          sales: 'Vendedor',
        };
        rows = agg.map((r) => buildRow(roleLabel[r._id] ?? r._id, r));
        break;
      }

      case 'stage': {
        const stageLabel: Record<string, string> = {
          draft: 'Rascunho',
          sent: 'Enviada',
          viewed: 'Visualizada',
          approved: 'Aprovada',
          rejected: 'Rejeitada',
          expired: 'Expirada',
          converted: 'Convertida',
        };
        const stageOrder = ['draft', 'sent', 'viewed', 'approved', 'rejected', 'expired', 'converted'];
        const agg = await Proposal.aggregate([
          { $match: match },
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 },
              approvedCount: {
                $sum: { $cond: [{ $in: ['$status', APPROVED_STATUSES] }, 1, 0] },
              },
              totalValue: { $sum: { $ifNull: ['$totalAmount', 0] } },
              approvedValue: {
                $sum: {
                  $cond: [
                    { $in: ['$status', APPROVED_STATUSES] },
                    { $ifNull: ['$totalAmount', 0] },
                    0,
                  ],
                },
              },
            },
          },
        ]);
        const aggMap = new Map(agg.map((r) => [r._id, r]));
        rows = stageOrder
          .filter((s) => aggMap.has(s))
          .map((s) => buildRow(stageLabel[s] ?? s, aggMap.get(s)!));
        break;
      }

      case 'insertionTable': {
        const agg = await Proposal.aggregate([
          { $match: match },
          { $unwind: { path: '$items', preserveNullAndEmptyArrays: true } },
          {
            $group: {
              _id: { $ifNull: ['$items.spotType', '$items.productName'] },
              count: { $sum: 1 },
              approvedCount: {
                $sum: { $cond: [{ $in: ['$status', APPROVED_STATUSES] }, 1, 0] },
              },
              totalValue: { $sum: { $ifNull: ['$items.totalPrice', 0] } },
              approvedValue: {
                $sum: {
                  $cond: [
                    { $in: ['$status', APPROVED_STATUSES] },
                    { $ifNull: ['$items.totalPrice', 0] },
                    0,
                  ],
                },
              },
            },
          },
          { $sort: { totalValue: -1 } },
        ]);
        rows = agg.map((r) => buildRow(r._id, r));
        break;
      }

      case 'combo': {
        const agg = await Proposal.aggregate([
          { $match: match },
          {
            $group: {
              _id: {
                $cond: [{ $gt: [{ $size: { $ifNull: ['$items', []] } }, 1] }, 'Combo', 'Individual'],
              },
              ...groupFields,
            },
          },
          { $sort: { count: -1 } },
        ]);
        rows = agg.map((r) => buildRow(r._id, r));
        break;
      }

      case 'timeSlot': {
        const agg = await Proposal.aggregate([
          { $match: match },
          { $unwind: { path: '$items', preserveNullAndEmptyArrays: true } },
          {
            $addFields: {
              startHour: {
                $toInt: {
                  $substr: [{ $ifNull: ['$items.timeRange.start', '00:00'] }, 0, 2],
                },
              },
            },
          },
          {
            $addFields: {
              timeSlotLabel: {
                $switch: {
                  branches: [
                    { case: { $lt: ['$startHour', 6] }, then: 'Madrugada (00h–06h)' },
                    { case: { $lt: ['$startHour', 12] }, then: 'Manhã (06h–12h)' },
                    { case: { $lt: ['$startHour', 18] }, then: 'Tarde (12h–18h)' },
                    { case: { $lt: ['$startHour', 22] }, then: 'Noite (18h–22h)' },
                  ],
                  default: 'Noite/Madrugada (22h–00h)',
                },
              },
            },
          },
          {
            $group: {
              _id: '$timeSlotLabel',
              count: { $sum: 1 },
              approvedCount: {
                $sum: { $cond: [{ $in: ['$status', APPROVED_STATUSES] }, 1, 0] },
              },
              totalValue: { $sum: { $ifNull: ['$items.totalPrice', 0] } },
              approvedValue: {
                $sum: {
                  $cond: [
                    { $in: ['$status', APPROVED_STATUSES] },
                    { $ifNull: ['$items.totalPrice', 0] },
                    0,
                  ],
                },
              },
            },
          },
          { $sort: { totalValue: -1 } },
        ]);
        rows = agg.map((r) => buildRow(r._id, r));
        break;
      }

      case 'dayOfWeek': {
        const dayNames = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
        const agg = await Proposal.aggregate([
          { $match: match },
          { $unwind: { path: '$items', preserveNullAndEmptyArrays: true } },
          { $unwind: { path: '$items.programDaysOfWeek', preserveNullAndEmptyArrays: true } },
          {
            $group: {
              _id: '$items.programDaysOfWeek',
              count: { $sum: 1 },
              approvedCount: {
                $sum: { $cond: [{ $in: ['$status', APPROVED_STATUSES] }, 1, 0] },
              },
              totalValue: { $sum: { $ifNull: ['$items.totalPrice', 0] } },
              approvedValue: {
                $sum: {
                  $cond: [
                    { $in: ['$status', APPROVED_STATUSES] },
                    { $ifNull: ['$items.totalPrice', 0] },
                    0,
                  ],
                },
              },
            },
          },
          { $sort: { _id: 1 } },
        ]);
        rows = agg.map((r) => buildRow(dayNames[r._id] ?? `Dia ${r._id}`, r));
        break;
      }

      case 'month': {
        const agg = await Proposal.aggregate([
          { $match: match },
          {
            $group: {
              _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
              ...groupFields,
            },
          },
          { $sort: { '_id.year': 1, '_id.month': 1 } },
        ]);
        rows = agg.map((r) => {
          const d = new Date(r._id.year, r._id.month - 1, 1);
          return buildRow(
            d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
            r
          );
        });
        break;
      }

      case 'year': {
        const agg = await Proposal.aggregate([
          { $match: match },
          {
            $group: {
              _id: { year: { $year: '$createdAt' } },
              ...groupFields,
            },
          },
          { $sort: { '_id.year': 1 } },
        ]);
        rows = agg.map((r) => buildRow(String(r._id.year), r));
        break;
      }

      case 'validity': {
        const agg = await Proposal.aggregate([
          { $match: { ...match, sentAt: { $exists: true }, validUntil: { $exists: true } } },
          {
            $addFields: {
              validDays: {
                $divide: [{ $subtract: ['$validUntil', '$sentAt'] }, 1000 * 60 * 60 * 24],
              },
            },
          },
          {
            $addFields: {
              validityBucket: {
                $switch: {
                  branches: [
                    { case: { $lte: ['$validDays', 3] }, then: 'Até 3 dias' },
                    { case: { $lte: ['$validDays', 7] }, then: '4–7 dias' },
                    { case: { $lte: ['$validDays', 15] }, then: '8–15 dias' },
                    { case: { $lte: ['$validDays', 30] }, then: '16–30 dias' },
                  ],
                  default: 'Mais de 30 dias',
                },
              },
            },
          },
          {
            $group: {
              _id: '$validityBucket',
              ...groupFields,
            },
          },
          { $sort: { count: -1 } },
        ]);
        rows = agg.map((r) => buildRow(r._id, r));
        break;
      }

      default:
        res.status(400).json({ error: `Dimensão "${by}" não suportada` });
        return;
    }

    res.json({ by, rows });
  } catch (err) {
    console.error('getBreakdown error:', err);
    res.status(500).json({ error: 'Erro ao buscar breakdown' });
  }
};

// GET /api/broadcaster/reports/goals
export const getGoalsReport = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (req.user?.userType !== 'broadcaster') {
      res.status(403).json({ error: 'Acesso restrito a emissoras' });
      return;
    }

    const managerId = getManagerId(req);
    const isSales = req.user?.broadcasterRole === 'sales';
    const broadcasterIds = await getAllBroadcasterIds(managerId);

    const goalsQuery: any = { broadcasterOwnerId: managerId };
    if (isSales) {
      goalsQuery.$or = [
        { type: 'general' },
        { type: 'individual', sellerId: new mongoose.Types.ObjectId(req.userId!) },
      ];
    }

    const goals = await Goal.find(goalsQuery).sort({ startDate: -1 });

    const goalsWithRealizado = await Promise.all(
      goals.map(async (goal) => {
        const proposalMatch: any = {
          broadcasterId: { $in: broadcasterIds },
          status: { $in: APPROVED_STATUSES },
          respondedAt: { $gte: goal.startDate, $lte: goal.endDate },
        };
        if (goal.type === 'individual' && goal.sellerId) {
          proposalMatch.createdBy = goal.sellerId;
        }

        const [totalResult, bySellerResult] = await Promise.all([
          Proposal.aggregate([
            { $match: proposalMatch },
            { $group: { _id: null, total: { $sum: '$totalAmount' }, count: { $sum: 1 } } },
          ]),
          goal.type === 'general'
            ? Proposal.aggregate([
                { $match: proposalMatch },
                {
                  $group: {
                    _id: '$createdBy',
                    value: { $sum: '$totalAmount' },
                    count: { $sum: 1 },
                  },
                },
                { $sort: { value: -1 } },
              ])
            : Promise.resolve([]),
        ]);

        const realizado = totalResult[0]?.total ?? 0;
        const realizadoCount = totalResult[0]?.count ?? 0;

        return {
          ...goal.toObject(),
          realizado,
          realizadoCount,
          percentual:
            goal.targetValue > 0
              ? Math.min((realizado / goal.targetValue) * 100, 999)
              : 0,
          bySeller: bySellerResult,
        };
      })
    );

    res.json({ goals: goalsWithRealizado });
  } catch (err) {
    console.error('getGoalsReport error:', err);
    res.status(500).json({ error: 'Erro ao buscar relatório de metas' });
  }
};
