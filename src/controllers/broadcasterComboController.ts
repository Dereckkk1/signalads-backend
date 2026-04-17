import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../middleware/auth';
import { Combo } from '../models/Combo';
import { Product } from '../models/Product';
import { Sponsorship } from '../models/Sponsorship';
import { User } from '../models/User';
import { getEffectiveBroadcasterId } from './broadcasterSubUserController';

function requireBroadcaster(req: AuthRequest, res: Response): boolean {
  if (req.user?.userType !== 'broadcaster') {
    res.status(403).json({ error: 'Acesso restrito a emissoras' });
    return false;
  }
  return true;
}

type RawComboItem = {
  itemType: 'product' | 'sponsorship';
  productId?: string;
  sponsorshipId?: string;
  defaultQuantity: number;
  defaultDiscountType?: 'percentage' | 'fixed';
  defaultDiscountValue?: number;
  isBonification?: boolean;
};

async function validateItems(items: RawComboItem[], broadcasterId: string): Promise<{ ok: true; items: any[] } | { ok: false; error: string }> {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: 'Combo deve ter pelo menos 1 item' };
  }

  const productIds: string[] = [];
  const sponsorshipIds: string[] = [];
  const normalized: any[] = [];

  for (const [i, raw] of items.entries()) {
    if (!raw || (raw.itemType !== 'product' && raw.itemType !== 'sponsorship')) {
      return { ok: false, error: `Item ${i + 1}: itemType deve ser "product" ou "sponsorship"` };
    }

    const qty = Number(raw.defaultQuantity);
    if (!Number.isFinite(qty) || qty < 1) {
      return { ok: false, error: `Item ${i + 1}: defaultQuantity deve ser >= 1` };
    }

    const discountValue = raw.defaultDiscountValue != null ? Number(raw.defaultDiscountValue) : 0;
    if (!Number.isFinite(discountValue) || discountValue < 0) {
      return { ok: false, error: `Item ${i + 1}: defaultDiscountValue inválido` };
    }
    const discountType: 'percentage' | 'fixed' = raw.defaultDiscountType === 'fixed' ? 'fixed' : 'percentage';
    if (discountType === 'percentage' && discountValue > 100) {
      return { ok: false, error: `Item ${i + 1}: desconto percentual não pode passar de 100%` };
    }

    if (raw.itemType === 'product') {
      if (!raw.productId || !mongoose.isValidObjectId(raw.productId)) {
        return { ok: false, error: `Item ${i + 1}: productId inválido` };
      }
      productIds.push(raw.productId);
      normalized.push({
        itemType: 'product',
        productId: raw.productId,
        defaultQuantity: qty,
        defaultDiscountType: discountType,
        defaultDiscountValue: discountValue,
        isBonification: !!raw.isBonification
      });
    } else {
      if (!raw.sponsorshipId || !mongoose.isValidObjectId(raw.sponsorshipId)) {
        return { ok: false, error: `Item ${i + 1}: sponsorshipId inválido` };
      }
      sponsorshipIds.push(raw.sponsorshipId);
      normalized.push({
        itemType: 'sponsorship',
        sponsorshipId: raw.sponsorshipId,
        defaultQuantity: qty,
        defaultDiscountType: discountType,
        defaultDiscountValue: discountValue,
        isBonification: !!raw.isBonification
      });
    }
  }

  if (productIds.length > 0) {
    const count = await Product.countDocuments({ _id: { $in: productIds }, broadcasterId });
    if (count !== new Set(productIds).size) {
      return { ok: false, error: 'Um ou mais produtos não pertencem à sua emissora' };
    }
  }
  if (sponsorshipIds.length > 0) {
    const count = await Sponsorship.countDocuments({ _id: { $in: sponsorshipIds }, broadcasterId });
    if (count !== new Set(sponsorshipIds).size) {
      return { ok: false, error: 'Um ou mais patrocínios não pertencem à sua emissora' };
    }
  }

  return { ok: true, items: normalized };
}

// Lista todos os combos da emissora autenticada
export const listCombos = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireBroadcaster(req, res)) return;
    const broadcasterId = getEffectiveBroadcasterId(req);
    if (!broadcasterId) {
      res.status(401).json({ error: 'Usuário não autenticado' });
      return;
    }

    const combos = await Combo.find({ broadcasterId })
      .sort({ createdAt: -1 })
      .populate('items.productId', 'name spotType duration timeSlot timeRange daysOfWeek netPrice pricePerInsertion isActive')
      .populate('items.sponsorshipId', 'programName description timeRange daysOfWeek insertions netPrice pricePerMonth isActive');

    res.json({ combos });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao listar combos' });
  }
};

// Cria um combo
export const createCombo = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireBroadcaster(req, res)) return;
    const broadcasterId = getEffectiveBroadcasterId(req);
    if (!broadcasterId) {
      res.status(401).json({ error: 'Usuário não autenticado' });
      return;
    }

    const user = await User.findById(broadcasterId);
    if (!user || user.userType !== 'broadcaster') {
      res.status(403).json({ error: 'Emissora não encontrada' });
      return;
    }

    const { name, description, items } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'Nome do combo é obrigatório' });
      return;
    }

    const validated = await validateItems(items, broadcasterId);
    if (!validated.ok) {
      res.status(400).json({ error: validated.error });
      return;
    }

    const combo = await Combo.create({
      broadcasterId,
      name: name.trim(),
      description: description?.trim(),
      items: validated.items,
      isActive: true
    });

    const populated = await Combo.findById(combo._id)
      .populate('items.productId', 'name spotType duration timeSlot timeRange daysOfWeek netPrice pricePerInsertion isActive')
      .populate('items.sponsorshipId', 'programName description timeRange daysOfWeek insertions netPrice pricePerMonth isActive');

    res.status(201).json({ combo: populated });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar combo' });
  }
};

// Atualiza um combo
export const updateCombo = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireBroadcaster(req, res)) return;
    const broadcasterId = getEffectiveBroadcasterId(req);
    if (!broadcasterId) {
      res.status(401).json({ error: 'Usuário não autenticado' });
      return;
    }
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      res.status(400).json({ error: 'ID inválido' });
      return;
    }

    const combo = await Combo.findOne({ _id: id, broadcasterId });
    if (!combo) {
      res.status(404).json({ error: 'Combo não encontrado' });
      return;
    }

    const { name, description, items, isActive } = req.body;

    if (name !== undefined) {
      if (!name || typeof name !== 'string' || !name.trim()) {
        res.status(400).json({ error: 'Nome do combo é obrigatório' });
        return;
      }
      combo.name = name.trim();
    }
    if (description !== undefined) combo.description = description?.trim();
    if (isActive !== undefined) combo.isActive = !!isActive;

    if (items !== undefined) {
      const validated = await validateItems(items, broadcasterId);
      if (!validated.ok) {
        res.status(400).json({ error: validated.error });
        return;
      }
      combo.items = validated.items as any;
    }

    await combo.save();

    const populated = await Combo.findById(combo._id)
      .populate('items.productId', 'name spotType duration timeSlot timeRange daysOfWeek netPrice pricePerInsertion isActive')
      .populate('items.sponsorshipId', 'programName description timeRange daysOfWeek insertions netPrice pricePerMonth isActive');

    res.json({ combo: populated });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar combo' });
  }
};

// Deleta um combo
export const deleteCombo = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireBroadcaster(req, res)) return;
    const broadcasterId = getEffectiveBroadcasterId(req);
    if (!broadcasterId) {
      res.status(401).json({ error: 'Usuário não autenticado' });
      return;
    }
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      res.status(400).json({ error: 'ID inválido' });
      return;
    }

    const combo = await Combo.findOneAndDelete({ _id: id, broadcasterId });
    if (!combo) {
      res.status(404).json({ error: 'Combo não encontrado' });
      return;
    }

    res.json({ message: 'Combo removido com sucesso' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao deletar combo' });
  }
};
