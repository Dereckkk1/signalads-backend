import { Response } from 'express';
import { Types } from 'mongoose';
import { AuthRequest } from '../middleware/auth';
import {
  KanbanBoard,
  KanbanContext,
  KanbanOwnerType,
} from '../models/KanbanBoard';
import { KanbanCardPlacement } from '../models/KanbanCardPlacement';

const VALID_CONTEXTS: KanbanContext[] = ['proposals', 'orders'];
const MAX_CUSTOM_COLUMNS = 20;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

interface KanbanScope {
  ownerType: KanbanOwnerType;
  ownerId: Types.ObjectId | null;
}

function resolveScope(req: AuthRequest): KanbanScope | null {
  const user = req.user;
  if (!user) return null;

  if (user.userType === 'admin') {
    return { ownerType: 'admin', ownerId: null };
  }
  if (user.userType === 'broadcaster') {
    const ownerId =
      user.broadcasterRole === 'sales' && user.parentBroadcasterId
        ? new Types.ObjectId(String(user.parentBroadcasterId))
        : new Types.ObjectId(String(user._id));
    return { ownerType: 'broadcaster', ownerId };
  }
  if (user.userType === 'agency') {
    return {
      ownerType: 'agency',
      ownerId: new Types.ObjectId(String(user._id)),
    };
  }
  return null;
}

function validContext(context: string | undefined): context is KanbanContext {
  return !!context && (VALID_CONTEXTS as string[]).includes(context);
}

function contextAllowedForScope(
  scope: KanbanScope,
  context: KanbanContext
): boolean {
  if (scope.ownerType === 'admin') return context === 'orders';
  return context === 'proposals';
}

async function getOrCreateBoard(
  scope: KanbanScope,
  context: KanbanContext
) {
  const existing = await KanbanBoard.findOne({
    ownerType: scope.ownerType,
    ownerId: scope.ownerId,
    context,
  });
  if (existing) return existing;

  return KanbanBoard.create({
    ownerType: scope.ownerType,
    ownerId: scope.ownerId,
    context,
    customColumns: [],
    columnOrder: [],
  });
}

// ─── Board ───────────────────────────────────────────

export const getBoard = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const scope = resolveScope(req);
    if (!scope) {
      res.status(403).json({ error: 'Tipo de usuario sem acesso ao kanban' });
      return;
    }
    const { context } = req.params;
    if (!validContext(context)) {
      res.status(400).json({ error: 'Contexto invalido' });
      return;
    }
    if (!contextAllowedForScope(scope, context)) {
      res.status(403).json({ error: 'Contexto nao disponivel para este usuario' });
      return;
    }

    const board = await getOrCreateBoard(scope, context);
    const placements = await KanbanCardPlacement.find({
      ownerType: scope.ownerType,
      ownerId: scope.ownerId,
      context,
    }).lean();

    res.json({
      customColumns: board.customColumns,
      columnOrder: board.columnOrder,
      placements: placements.map((p) => ({
        cardId: String(p.cardId),
        cardType: p.cardType,
        columnId: p.columnId,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao carregar kanban' });
  }
};

// ─── Custom columns ─────────────────────────────────

export const createColumn = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const scope = resolveScope(req);
    if (!scope) {
      res.status(403).json({ error: 'Tipo de usuario sem acesso ao kanban' });
      return;
    }
    const { context } = req.params;
    if (!validContext(context)) {
      res.status(400).json({ error: 'Contexto invalido' });
      return;
    }
    if (!contextAllowedForScope(scope, context)) {
      res.status(403).json({ error: 'Contexto nao disponivel para este usuario' });
      return;
    }

    const { name, color, icon } = req.body ?? {};
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    const trimmedIcon = typeof icon === 'string' ? icon.trim() : '';

    if (!trimmedName) {
      res.status(400).json({ error: 'Nome obrigatorio' });
      return;
    }
    if (trimmedName.length > 40) {
      res.status(400).json({ error: 'Nome deve ter no maximo 40 caracteres' });
      return;
    }
    if (!trimmedIcon) {
      res.status(400).json({ error: 'Icone obrigatorio' });
      return;
    }
    if (typeof color !== 'string' || !HEX_COLOR.test(color)) {
      res.status(400).json({ error: 'Cor deve estar no formato #RRGGBB' });
      return;
    }

    const board = await getOrCreateBoard(scope, context);
    if (board.customColumns.length >= MAX_CUSTOM_COLUMNS) {
      res.status(400).json({
        error: `Limite de ${MAX_CUSTOM_COLUMNS} colunas customizadas atingido`,
      });
      return;
    }

    const newColumn = {
      _id: new Types.ObjectId(),
      name: trimmedName,
      color,
      icon: trimmedIcon,
      createdAt: new Date(),
      createdBy: req.userId ? new Types.ObjectId(req.userId) : undefined,
    };

    board.customColumns.push(newColumn as any);
    if (!board.columnOrder.includes(String(newColumn._id))) {
      board.columnOrder.push(String(newColumn._id));
    }
    await board.save();

    res.status(201).json({
      column: newColumn,
      columnOrder: board.columnOrder,
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar coluna' });
  }
};

export const updateColumn = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const scope = resolveScope(req);
    if (!scope) {
      res.status(403).json({ error: 'Tipo de usuario sem acesso ao kanban' });
      return;
    }
    const { context, columnId } = req.params;
    if (!validContext(context)) {
      res.status(400).json({ error: 'Contexto invalido' });
      return;
    }
    if (!contextAllowedForScope(scope, context)) {
      res.status(403).json({ error: 'Contexto nao disponivel para este usuario' });
      return;
    }

    const board = await KanbanBoard.findOne({
      ownerType: scope.ownerType,
      ownerId: scope.ownerId,
      context,
    });
    if (!board) {
      res.status(404).json({ error: 'Kanban nao encontrado' });
      return;
    }

    const column = board.customColumns.find(
      (c) => String(c._id) === String(columnId)
    );
    if (!column) {
      res.status(404).json({ error: 'Coluna nao encontrada' });
      return;
    }

    const { name, color, icon } = req.body ?? {};
    if (typeof name === 'string') {
      const trimmed = name.trim();
      if (!trimmed) {
        res.status(400).json({ error: 'Nome nao pode ser vazio' });
        return;
      }
      if (trimmed.length > 40) {
        res.status(400).json({ error: 'Nome deve ter no maximo 40 caracteres' });
        return;
      }
      column.name = trimmed;
    }
    if (typeof color === 'string') {
      if (!HEX_COLOR.test(color)) {
        res.status(400).json({ error: 'Cor deve estar no formato #RRGGBB' });
        return;
      }
      column.color = color;
    }
    if (typeof icon === 'string') {
      const trimmed = icon.trim();
      if (!trimmed) {
        res.status(400).json({ error: 'Icone nao pode ser vazio' });
        return;
      }
      column.icon = trimmed;
    }

    await board.save();
    res.json({ column });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar coluna' });
  }
};

export const deleteColumn = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const scope = resolveScope(req);
    if (!scope) {
      res.status(403).json({ error: 'Tipo de usuario sem acesso ao kanban' });
      return;
    }
    const { context, columnId } = req.params;
    if (!validContext(context)) {
      res.status(400).json({ error: 'Contexto invalido' });
      return;
    }
    if (!contextAllowedForScope(scope, context)) {
      res.status(403).json({ error: 'Contexto nao disponivel para este usuario' });
      return;
    }

    const board = await KanbanBoard.findOne({
      ownerType: scope.ownerType,
      ownerId: scope.ownerId,
      context,
    });
    if (!board) {
      res.status(404).json({ error: 'Kanban nao encontrado' });
      return;
    }

    const idx = board.customColumns.findIndex(
      (c) => String(c._id) === String(columnId)
    );
    if (idx === -1) {
      res.status(404).json({ error: 'Coluna nao encontrada' });
      return;
    }

    board.customColumns.splice(idx, 1);
    board.columnOrder = board.columnOrder.filter(
      (id) => id !== String(columnId)
    );
    await board.save();

    await KanbanCardPlacement.deleteMany({
      ownerType: scope.ownerType,
      ownerId: scope.ownerId,
      context,
      columnId: String(columnId),
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao excluir coluna' });
  }
};

export const updateColumnOrder = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const scope = resolveScope(req);
    if (!scope) {
      res.status(403).json({ error: 'Tipo de usuario sem acesso ao kanban' });
      return;
    }
    const { context } = req.params;
    if (!validContext(context)) {
      res.status(400).json({ error: 'Contexto invalido' });
      return;
    }
    if (!contextAllowedForScope(scope, context)) {
      res.status(403).json({ error: 'Contexto nao disponivel para este usuario' });
      return;
    }

    const { columnOrder } = req.body ?? {};
    if (
      !Array.isArray(columnOrder) ||
      !columnOrder.every((id) => typeof id === 'string')
    ) {
      res
        .status(400)
        .json({ error: 'columnOrder deve ser array de strings' });
      return;
    }
    if (columnOrder.length > 100) {
      res.status(400).json({ error: 'columnOrder muito grande' });
      return;
    }

    const board = await getOrCreateBoard(scope, context);
    board.columnOrder = columnOrder;
    await board.save();

    res.json({ columnOrder: board.columnOrder });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao reordenar colunas' });
  }
};

// ─── Placements ──────────────────────────────────────

export const setPlacement = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const scope = resolveScope(req);
    if (!scope) {
      res.status(403).json({ error: 'Tipo de usuario sem acesso ao kanban' });
      return;
    }
    const { context } = req.params;
    if (!validContext(context)) {
      res.status(400).json({ error: 'Contexto invalido' });
      return;
    }
    if (!contextAllowedForScope(scope, context)) {
      res.status(403).json({ error: 'Contexto nao disponivel para este usuario' });
      return;
    }

    const { cardId, cardType, columnId } = req.body ?? {};

    if (!cardId || !Types.ObjectId.isValid(String(cardId))) {
      res.status(400).json({ error: 'cardId invalido' });
      return;
    }

    const expectedCardType: 'proposal' | 'order' =
      context === 'proposals' ? 'proposal' : 'order';
    if (cardType && cardType !== expectedCardType) {
      res.status(400).json({ error: 'cardType nao corresponde ao contexto' });
      return;
    }

    if (columnId === null || columnId === undefined || columnId === '') {
      await KanbanCardPlacement.deleteOne({
        ownerType: scope.ownerType,
        ownerId: scope.ownerId,
        context,
        cardId: new Types.ObjectId(String(cardId)),
      });
      res.json({ success: true, cleared: true });
      return;
    }

    if (typeof columnId !== 'string') {
      res.status(400).json({ error: 'columnId deve ser string' });
      return;
    }

    const board = await KanbanBoard.findOne({
      ownerType: scope.ownerType,
      ownerId: scope.ownerId,
      context,
    });
    const columnExists = board?.customColumns.some(
      (c) => String(c._id) === columnId
    );
    if (!columnExists) {
      res.status(404).json({ error: 'Coluna customizada nao encontrada' });
      return;
    }

    const placement = await KanbanCardPlacement.findOneAndUpdate(
      {
        ownerType: scope.ownerType,
        ownerId: scope.ownerId,
        context,
        cardId: new Types.ObjectId(String(cardId)),
      },
      {
        $set: {
          ownerType: scope.ownerType,
          ownerId: scope.ownerId,
          context,
          cardType: expectedCardType,
          cardId: new Types.ObjectId(String(cardId)),
          columnId,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({
      success: true,
      placement: {
        cardId: String(placement.cardId),
        cardType: placement.cardType,
        columnId: placement.columnId,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao mover card' });
  }
};
