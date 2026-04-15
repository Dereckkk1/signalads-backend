import { Request, Response } from 'express';
import mongoose from 'mongoose';
import Goal from '../models/Goal';
import { User, IUser } from '../models/User';
import Proposal from '../models/Proposal';

interface AuthRequest extends Request {
  user?: any;
  userId?: string;
}

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

function buildProposalMatch(
  broadcasterIds: mongoose.Types.ObjectId[],
  startDate: Date,
  endDate: Date,
  sellerId?: mongoose.Types.ObjectId | null
) {
  const match: any = {
    broadcasterId: { $in: broadcasterIds },
    status: 'approved',
    respondedAt: { $gte: startDate, $lte: endDate },
  };
  if (sellerId) {
    match.createdBy = sellerId;
  }
  return match;
}

// GET /api/broadcaster/goals
export const listGoals = async (req: AuthRequest, res: Response): Promise<void> => {
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
        const match = buildProposalMatch(
          broadcasterIds,
          goal.startDate,
          goal.endDate,
          goal.type === 'individual' ? goal.sellerId : null
        );

        const result = await Proposal.aggregate([
          { $match: match },
          { $group: { _id: null, total: { $sum: '$totalAmount' }, count: { $sum: 1 } } },
        ]);

        const realizado = result[0]?.total ?? 0;
        const realizadoCount = result[0]?.count ?? 0;

        return {
          ...goal.toObject(),
          realizado,
          realizadoCount,
          percentual: goal.targetValue > 0 ? Math.min((realizado / goal.targetValue) * 100, 999) : 0,
        };
      })
    );

    res.json({ goals: goalsWithRealizado });
  } catch (err) {
    console.error('listGoals error:', err);
    res.status(500).json({ error: 'Erro ao buscar metas' });
  }
};

// GET /api/broadcaster/goals/analytics
export const getGoalsAnalytics = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (req.user?.userType !== 'broadcaster') {
      res.status(403).json({ error: 'Acesso restrito a emissoras' });
      return;
    }

    const managerId = getManagerId(req);
    const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };

    if (!startDate || !endDate) {
      res.status(400).json({ error: 'startDate e endDate são obrigatórios' });
      return;
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    const broadcasterIds = await getAllBroadcasterIds(managerId);

    // Sub-users para mapear nomes
    const subUsers = await User.find(
      { parentBroadcasterId: managerId, userType: 'broadcaster' },
      { _id: 1, name: 1 }
    );
    const managerUser = await User.findById(managerId, { name: 1 });

    const sellerMap = new Map<string, string>([
      [managerId, managerUser?.name ?? 'Gerente'],
      ...subUsers.map((u: IUser) => [u._id.toString(), u.name] as [string, string]),
    ]);

    const baseMatch = buildProposalMatch(broadcasterIds, start, end, null);

    // Breakdown mensal
    const monthly = await Proposal.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: {
            year: { $year: '$respondedAt' },
            month: { $month: '$respondedAt' },
          },
          value: { $sum: '$totalAmount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    // Breakdown por vendedor
    const bySeller = await Proposal.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: '$createdBy',
          value: { $sum: '$totalAmount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { value: -1 } },
    ]);

    const bySellerNamed = bySeller.map((s) => ({
      sellerId: s._id,
      sellerName: s._id ? (sellerMap.get(s._id.toString()) ?? 'Desconhecido') : (managerUser?.name ?? 'Gerente'),
      value: s.value,
      count: s.count,
    }));

    // Breakdown mensal por vendedor
    const monthlyBySeller = await Proposal.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: {
            year: { $year: '$respondedAt' },
            month: { $month: '$respondedAt' },
            sellerId: '$createdBy',
          },
          value: { $sum: '$totalAmount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    // Total geral
    const totalResult = await Proposal.aggregate([
      { $match: baseMatch },
      { $group: { _id: null, total: { $sum: '$totalAmount' }, count: { $sum: 1 } } },
    ]);

    res.json({
      total: totalResult[0]?.total ?? 0,
      totalCount: totalResult[0]?.count ?? 0,
      monthly: monthly.map((m) => ({
        year: m._id.year,
        month: m._id.month,
        label: `${String(m._id.month).padStart(2, '0')}/${m._id.year}`,
        value: m.value,
        count: m.count,
      })),
      bySeller: bySellerNamed,
      monthlyBySeller: monthlyBySeller.map((m) => ({
        year: m._id.year,
        month: m._id.month,
        label: `${String(m._id.month).padStart(2, '0')}/${m._id.year}`,
        sellerId: m._id.sellerId,
        sellerName: m._id.sellerId
          ? (sellerMap.get(m._id.sellerId.toString()) ?? 'Desconhecido')
          : (managerUser?.name ?? 'Gerente'),
        value: m.value,
        count: m.count,
      })),
    });
  } catch (err) {
    console.error('getGoalsAnalytics error:', err);
    res.status(500).json({ error: 'Erro ao buscar analytics' });
  }
};

// POST /api/broadcaster/goals
export const createGoal = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireManager(req, res)) return;

    const { type, sellerId, sellerName, targetValue, startDate, endDate, description } = req.body;

    if (!type || targetValue == null || !startDate || !endDate) {
      res.status(400).json({ error: 'Campos obrigatórios: tipo, valor alvo, data início e data fim' });
      return;
    }

    if (!['general', 'individual'].includes(type)) {
      res.status(400).json({ error: 'Tipo inválido. Use "general" ou "individual"' });
      return;
    }

    if (type === 'individual' && !sellerId) {
      res.status(400).json({ error: 'Meta individual requer um vendedor' });
      return;
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (start >= end) {
      res.status(400).json({ error: 'Data início deve ser anterior à data fim' });
      return;
    }

    if (Number(targetValue) <= 0) {
      res.status(400).json({ error: 'Valor alvo deve ser maior que zero' });
      return;
    }

    const goal = await Goal.create({
      broadcasterOwnerId: req.userId,
      type,
      sellerId: sellerId || undefined,
      sellerName: sellerName || undefined,
      targetValue: Number(targetValue),
      startDate: start,
      endDate: end,
      description: description || undefined,
    });

    res.status(201).json({ goal });
  } catch (err) {
    console.error('createGoal error:', err);
    res.status(500).json({ error: 'Erro ao criar meta' });
  }
};

// PUT /api/broadcaster/goals/:id
export const updateGoal = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireManager(req, res)) return;

    const { targetValue, startDate, endDate, description } = req.body;

    const goal = await Goal.findOne({ _id: req.params.id, broadcasterOwnerId: req.userId });
    if (!goal) {
      res.status(404).json({ error: 'Meta não encontrada' });
      return;
    }

    if (targetValue != null) {
      if (Number(targetValue) <= 0) {
        res.status(400).json({ error: 'Valor alvo deve ser maior que zero' });
        return;
      }
      goal.targetValue = Number(targetValue);
    }

    if (startDate) goal.startDate = new Date(startDate);
    if (endDate) goal.endDate = new Date(endDate);
    if (description !== undefined) goal.description = description;

    if (goal.startDate >= goal.endDate) {
      res.status(400).json({ error: 'Data início deve ser anterior à data fim' });
      return;
    }

    await goal.save();
    res.json({ goal });
  } catch (err) {
    console.error('updateGoal error:', err);
    res.status(500).json({ error: 'Erro ao atualizar meta' });
  }
};

// DELETE /api/broadcaster/goals/:id
export const deleteGoal = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireManager(req, res)) return;

    const goal = await Goal.findOneAndDelete({ _id: req.params.id, broadcasterOwnerId: req.userId });
    if (!goal) {
      res.status(404).json({ error: 'Meta não encontrada' });
      return;
    }

    res.json({ message: 'Meta removida com sucesso' });
  } catch (err) {
    console.error('deleteGoal error:', err);
    res.status(500).json({ error: 'Erro ao remover meta' });
  }
};
