import { Response } from 'express';
import { InsertionTimeSlot } from '../models/InsertionTimeSlot';
import { User } from '../models/User';
import { AuthRequest } from '../middleware/auth';
import { getEffectiveBroadcasterId } from './broadcasterSubUserController';

// Listar faixas horárias da emissora
export const getMyTimeSlots = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: 'Usuário não autenticado' });
      return;
    }

    const user = await User.findById(req.userId);
    if (!user || (user.userType !== 'broadcaster' && user.userType !== 'admin')) {
      res.status(403).json({ error: 'Acesso negado' });
      return;
    }

    const targetId = user.userType === 'admin' && req.query.broadcasterId
      ? (req.query.broadcasterId as string)
      : getEffectiveBroadcasterId(req);

    const slots = await InsertionTimeSlot.find({ broadcasterId: targetId }).sort({ createdAt: 1 });
    res.json(slots);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar faixas horárias' });
  }
};

// Criar faixa horária
export const createTimeSlot = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: 'Usuário não autenticado' });
      return;
    }

    const user = await User.findById(req.userId);
    if (!user || (user.userType !== 'broadcaster' && user.userType !== 'admin')) {
      res.status(403).json({ error: 'Acesso negado' });
      return;
    }

    const { name, type, start, end, customLabel } = req.body;

    if (!name || !type) {
      res.status(400).json({ error: 'Nome e tipo são obrigatórios' });
      return;
    }

    if (type === 'determinado' && (!start || !end)) {
      res.status(400).json({ error: 'Informe o horário de início e fim para faixa determinada' });
      return;
    }

    const targetId = user.userType === 'broadcaster' ? getEffectiveBroadcasterId(req) : req.body.broadcasterId;
    if (!targetId) {
      res.status(400).json({ error: 'ID da emissora é obrigatório para administradores' });
      return;
    }

    const slot = new InsertionTimeSlot({
      broadcasterId: targetId,
      name: name.trim(),
      type,
      start: type === 'determinado' ? start : undefined,
      end: type === 'determinado' ? end : undefined,
      customLabel: type === 'outro' ? customLabel.trim() : undefined
    });

    await slot.save();
    res.status(201).json(slot);
  } catch {
    res.status(500).json({ error: 'Erro ao criar faixa horária' });
  }
};

// Atualizar faixa horária
export const updateTimeSlot = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: 'Usuário não autenticado' });
      return;
    }

    const user = await User.findById(req.userId);
    if (!user || (user.userType !== 'broadcaster' && user.userType !== 'admin')) {
      res.status(403).json({ error: 'Acesso negado' });
      return;
    }

    const { id } = req.params;
    const query: any = { _id: id };
    if (user.userType === 'broadcaster') query.broadcasterId = getEffectiveBroadcasterId(req);

    const slot = await InsertionTimeSlot.findOne(query);
    if (!slot) {
      res.status(404).json({ error: 'Faixa horária não encontrada' });
      return;
    }

    const { name, type, start, end, customLabel } = req.body;

    if (name !== undefined) {
      if (!name.trim()) {
        res.status(400).json({ error: 'Nome não pode ser vazio' });
        return;
      }
      slot.name = name.trim();
    }

    if (type !== undefined) {
      if (!type.trim()) {
        res.status(400).json({ error: 'Tipo não pode ser vazio' });
        return;
      }
      slot.type = type.trim();
    }

    const finalType = type ?? slot.type;

    if (finalType === 'determinado') {
      const finalStart = start ?? slot.start;
      const finalEnd = end ?? slot.end;
      if (!finalStart || !finalEnd) {
        res.status(400).json({ error: 'Informe o horário de início e fim para faixa determinada' });
        return;
      }
      slot.start = finalStart;
      slot.end = finalEnd;
    } else {
      slot.set('start', undefined);
      slot.set('end', undefined);
    }

    if (customLabel !== undefined) {
      slot.customLabel = customLabel?.trim() || undefined;
    }

    await slot.save();
    res.json(slot);
  } catch {
    res.status(500).json({ error: 'Erro ao atualizar faixa horária' });
  }
};

// Excluir faixa horária
export const deleteTimeSlot = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: 'Usuário não autenticado' });
      return;
    }

    const user = await User.findById(req.userId);
    if (!user || (user.userType !== 'broadcaster' && user.userType !== 'admin')) {
      res.status(403).json({ error: 'Acesso negado' });
      return;
    }

    const { id } = req.params;
    const query: any = { _id: id };
    if (user.userType === 'broadcaster') query.broadcasterId = getEffectiveBroadcasterId(req);

    const slot = await InsertionTimeSlot.findOneAndDelete(query);
    if (!slot) {
      res.status(404).json({ error: 'Faixa horária não encontrada' });
      return;
    }

    res.json({ message: 'Faixa horária excluída com sucesso' });
  } catch {
    res.status(500).json({ error: 'Erro ao excluir faixa horária' });
  }
};
