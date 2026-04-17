import { Request, Response } from 'express';
import mongoose from 'mongoose';
import Order from '../models/Order';
import Proposal from '../models/Proposal';
import { Sponsorship } from '../models/Sponsorship';
import { User, IUser } from '../models/User';

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

// GET /api/broadcaster/calendar
// Query params: start (YYYY-MM-DD), end (YYYY-MM-DD)
export const getCalendarEvents = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (req.user?.userType !== 'broadcaster') {
      res.status(403).json({ error: 'Acesso restrito a emissoras' });
      return;
    }

    const managerId = getManagerId(req);
    const broadcasterIds = await getAllBroadcasterIds(managerId);
    const { start, end } = req.query as { start?: string; end?: string };

    if (!start || !end) {
      res.status(400).json({ error: 'Parâmetros start e end são obrigatórios (YYYY-MM-DD)' });
      return;
    }

    const startDate = new Date(start);
    const endDate = new Date(end);
    endDate.setHours(23, 59, 59, 999);

    // Sales sub-users: filter by their own proposals/orders
    const isSales = req.user?.broadcasterRole === 'sales';
    const salesFilter = isSales ? { createdBy: new mongoose.Types.ObjectId(req.userId!) } : {};

    const [orders, proposals, sponsorships] = await Promise.all([
      // 1. Orders with scheduled broadcasts in the date range
      Order.find({
        'items.broadcasterId': { $in: broadcasterIds.map(id => id.toString()) },
        status: { $in: ['approved', 'scheduled', 'in_progress', 'completed', 'paid', 'pending_approval'] },
      }).select('orderNumber buyerName clientId status items createdAt approvedAt').lean(),

      // 2. Proposals with validUntil in range OR with scheduled items in range
      Proposal.find({
        broadcasterId: { $in: broadcasterIds },
        ownerType: 'broadcaster',
        status: { $in: ['sent', 'viewed', 'approved', 'converted', 'draft'] },
        ...salesFilter,
      }).select('proposalNumber title clientName status validUntil items sentAt createdAt totalAmount').lean(),

      // 3. Active sponsorships (recurring)
      Sponsorship.find({
        broadcasterId: { $in: broadcasterIds },
        isActive: true,
      }).select('programName timeRange daysOfWeek insertions netPrice pricePerMonth').lean(),
    ]);

    const events: any[] = [];

    // --- Process Orders (veiculações agendadas) ---
    for (const order of orders) {
      for (const item of order.items) {
        // Only items belonging to this broadcaster
        if (!broadcasterIds.some(id => id.toString() === item.broadcasterId)) continue;

        const schedule = item.schedule instanceof Map
          ? Object.fromEntries(item.schedule)
          : (item.schedule || {});

        for (const [dateStr, qty] of Object.entries(schedule)) {
          const d = new Date(dateStr);
          if (d >= startDate && d <= endDate) {
            events.push({
              id: `order-${order._id}-${item.productId}-${dateStr}`,
              type: 'veiculacao',
              date: dateStr,
              title: item.itemType === 'sponsorship'
                ? `${item.programName || 'Patrocínio'}`
                : `${item.productName}`,
              subtitle: order.buyerName,
              quantity: qty,
              orderId: order._id,
              orderNumber: order.orderNumber,
              orderStatus: order.status,
              itemType: item.itemType || 'product',
              programName: item.programName,
              programTimeRange: item.programTimeRange,
              color: item.itemType === 'sponsorship' ? 'secondary' : 'primary',
            });
          }
        }
      }
    }

    // --- Process Proposals ---
    for (const proposal of proposals) {
      // Vencimento da proposta
      if (proposal.validUntil) {
        const vDate = new Date(proposal.validUntil);
        if (vDate >= startDate && vDate <= endDate) {
          const isExpiringSoon = (vDate.getTime() - Date.now()) < 3 * 24 * 60 * 60 * 1000; // 3 dias
          events.push({
            id: `proposal-expiry-${proposal._id}`,
            type: 'vencimento_proposta',
            date: vDate.toISOString().split('T')[0],
            title: `Vencimento: ${proposal.title || proposal.proposalNumber}`,
            subtitle: proposal.clientName || 'Sem cliente',
            proposalId: proposal._id,
            proposalNumber: proposal.proposalNumber,
            proposalStatus: proposal.status,
            totalAmount: proposal.totalAmount,
            isExpiringSoon,
            color: isExpiringSoon ? 'error' : 'warning',
          });
        }
      }

      // Itens agendados de propostas (aprovadas/convertidas = veiculações via proposta)
      if (['approved', 'converted'].includes(proposal.status)) {
        for (const item of proposal.items) {
          const schedule = item.schedule instanceof Map
            ? Object.fromEntries(item.schedule)
            : (item.schedule || {});

          for (const [dateStr, qty] of Object.entries(schedule)) {
            const d = new Date(dateStr);
            if (d >= startDate && d <= endDate) {
              events.push({
                id: `proposal-schedule-${proposal._id}-${dateStr}-${item.productName}`,
                type: 'veiculacao_proposta',
                date: dateStr,
                title: item.itemType === 'sponsorship'
                  ? `${item.programName || 'Patrocínio'} (Proposta)`
                  : `${item.productName} (Proposta)`,
                subtitle: proposal.clientName || 'Sem cliente',
                quantity: qty,
                proposalId: proposal._id,
                proposalNumber: proposal.proposalNumber,
                proposalStatus: proposal.status,
                itemType: item.itemType || 'product',
                programName: item.programName,
                programTimeRange: item.programTimeRange,
                color: item.itemType === 'sponsorship' ? 'tertiary' : 'success',
              });
            }
          }
        }
      }
    }

    // --- Process Sponsorships (recurring by day of week) ---
    const current = new Date(startDate);
    while (current <= endDate) {
      const dayOfWeek = current.getDay(); // 0=Dom..6=Sab
      const dateStr = current.toISOString().split('T')[0];

      for (const sp of sponsorships) {
        if (sp.daysOfWeek.includes(dayOfWeek)) {
          // Check if there's already an order-based event for this sponsorship on this date
          const hasOrderEvent = events.some(
            e => e.type === 'veiculacao' && e.date === dateStr && e.itemType === 'sponsorship' && e.programName === sp.programName
          );
          const hasProposalEvent = events.some(
            e => e.type === 'veiculacao_proposta' && e.date === dateStr && e.programName === sp.programName
          );

          events.push({
            id: `sponsorship-${sp._id}-${dateStr}`,
            type: 'patrocinio',
            date: dateStr,
            title: sp.programName,
            subtitle: `${sp.timeRange.start} - ${sp.timeRange.end}`,
            timeRange: sp.timeRange,
            daysOfWeek: sp.daysOfWeek,
            insertions: sp.insertions,
            totalInsertionsPerDay: sp.insertions.reduce((sum: number, ins: any) => sum + ins.quantityPerDay, 0),
            sponsorshipId: sp._id,
            pricePerMonth: sp.pricePerMonth,
            hasOrderEvent,
            hasProposalEvent,
            color: hasOrderEvent || hasProposalEvent ? 'tertiary' : 'neutral',
          });
        }
      }

      current.setDate(current.getDate() + 1);
    }

    // Sort events by date
    events.sort((a, b) => a.date.localeCompare(b.date));

    // Build summary counts per date
    const dateSummary: Record<string, { veiculacoes: number; patrocinios: number; vencimentos: number; propostas: number }> = {};
    for (const ev of events) {
      if (!dateSummary[ev.date]) {
        dateSummary[ev.date] = { veiculacoes: 0, patrocinios: 0, vencimentos: 0, propostas: 0 };
      }
      const entry = dateSummary[ev.date]!;
      if (ev.type === 'veiculacao') entry.veiculacoes++;
      else if (ev.type === 'patrocinio') entry.patrocinios++;
      else if (ev.type === 'vencimento_proposta') entry.vencimentos++;
      else if (ev.type === 'veiculacao_proposta') entry.propostas++;
    }

    res.json({
      events,
      dateSummary,
      totalEvents: events.length,
    });
  } catch (err: any) {
    console.error('Erro ao buscar eventos do calendário:', err);
    res.status(500).json({ error: 'Erro interno ao buscar eventos do calendário' });
  }
};
