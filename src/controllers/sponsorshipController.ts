import { Response } from 'express';
import { Sponsorship } from '../models/Sponsorship';
import { User } from '../models/User';
import { AuthRequest } from '../middleware/auth';
import { PLATFORM_COMMISSION_RATE } from '../models/Product';
import { cacheGet, cacheSet, cacheInvalidate } from '../config/redis';
import crypto from 'crypto';
import { getEffectiveBroadcasterId } from './broadcasterSubUserController';

function buildCacheKey(prefix: string, params: Record<string, any>): string {
  const normalized: Record<string, any> = {};
  for (const key of Object.keys(params).sort()) {
    const val = params[key];
    if (val === undefined || val === null || val === '') continue;
    if (Array.isArray(val)) {
      normalized[key] = [...val].sort();
    } else {
      normalized[key] = val;
    }
  }
  const hash = crypto.createHash('md5').update(JSON.stringify(normalized)).digest('hex').slice(0, 12);
  return `${prefix}:${hash}`;
}

// Listar patrocínios da emissora (broadcaster) ou de qualquer emissora (admin)
export const getMySponsorships = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: 'Usuário não autenticado' });
      return;
    }

    const user = await User.findById(req.userId);
    if (!user) {
      res.status(401).json({ error: 'Usuário não encontrado' });
      return;
    }

    const { broadcasterId } = req.query;
    let query: any;

    if (user.userType === 'admin' && broadcasterId) {
      query = { broadcasterId: broadcasterId as string };
    } else if (user.userType === 'broadcaster') {
      query = { broadcasterId: getEffectiveBroadcasterId(req) };
    } else if (user.userType === 'admin' && !broadcasterId) {
      query = {};
    } else {
      res.status(403).json({ error: 'Apenas administradores e emissoras podem listar patrocínios' });
      return;
    }

    const sponsorships = await Sponsorship.find(query)
      .populate('broadcasterId', 'companyName email')
      .sort({ createdAt: -1 });

    res.json(sponsorships);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar patrocínios' });
  }
};

// Criar novo patrocínio (Broadcaster ou Admin)
export const createSponsorship = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { programName, description, timeRange, daysOfWeek, insertions, announcer, netPrice, broadcasterId } = req.body;

    const user = await User.findById(req.userId);
    if (!user || (user.userType !== 'broadcaster' && user.userType !== 'admin')) {
      res.status(403).json({ error: 'Apenas emissoras e administradores podem cadastrar patrocínios' });
      return;
    }

    // Determina emissora alvo
    let targetBroadcasterId: string;
    if (user.userType === 'broadcaster') {
      // Sub-user (sales) deve criar em nome do parent broadcaster, nao em nome proprio
      const effectiveId = getEffectiveBroadcasterId(req);
      if (!effectiveId) {
        res.status(401).json({ error: 'Usuário não autenticado' });
        return;
      }
      targetBroadcasterId = effectiveId;
    } else {
      if (!broadcasterId) {
        res.status(400).json({ error: 'ID da emissora é obrigatório para administradores' });
        return;
      }
      targetBroadcasterId = broadcasterId;
    }

    // Valida emissora alvo
    const broadcaster = await User.findById(targetBroadcasterId);
    if (!broadcaster || broadcaster.userType !== 'broadcaster') {
      res.status(404).json({ error: 'Emissora não encontrada ou ID inválido' });
      return;
    }

    // Validações
    if (!programName || !timeRange?.start || !timeRange?.end || !daysOfWeek || !insertions || !netPrice) {
      res.status(400).json({ error: 'programName, timeRange (start/end), daysOfWeek, insertions e netPrice são obrigatórios' });
      return;
    }

    const parsedNetPrice = parseFloat(netPrice);
    if (isNaN(parsedNetPrice) || parsedNetPrice <= 0) {
      res.status(400).json({ error: 'netPrice deve ser um valor positivo' });
      return;
    }

    if (!Array.isArray(daysOfWeek) || daysOfWeek.length === 0 || !daysOfWeek.every((d: number) => d >= 0 && d <= 6)) {
      res.status(400).json({ error: 'daysOfWeek deve ser um array com valores de 0 (Dom) a 6 (Sáb)' });
      return;
    }

    if (!Array.isArray(insertions) || insertions.length === 0) {
      res.status(400).json({ error: 'Patrocínio deve ter pelo menos 1 inserção' });
      return;
    }

    for (const ins of insertions) {
      if (!ins.name || !ins.quantityPerDay || ins.quantityPerDay < 1) {
        res.status(400).json({ error: 'Cada inserção deve ter name e quantityPerDay >= 1' });
        return;
      }
    }

    const sponsorship = new Sponsorship({
      broadcasterId: targetBroadcasterId,
      programName,
      description,
      timeRange,
      daysOfWeek,
      insertions,
      announcer,
      netPrice: parsedNetPrice,
      pricePerMonth: Math.round(parsedNetPrice * (1 + PLATFORM_COMMISSION_RATE) * 100) / 100
    });

    await sponsorship.save();

    await cacheInvalidate('sponsorship-marketplace:*');

    res.status(201).json({
      message: 'Patrocínio cadastrado com sucesso!',
      sponsorship
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar patrocínio' });
  }
};

// Atualizar patrocínio (Broadcaster ou Admin)
export const updateSponsorship = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: 'Usuário não autenticado' });
      return;
    }

    const user = await User.findById(req.userId);
    if (!user || (user.userType !== 'broadcaster' && user.userType !== 'admin')) {
      res.status(403).json({ error: 'Apenas emissoras e administradores podem atualizar patrocínios' });
      return;
    }

    const { id } = req.params;
    let query: any = { _id: id };

    if (user.userType === 'broadcaster') {
      query.broadcasterId = getEffectiveBroadcasterId(req);
    }

    const sponsorship = await Sponsorship.findOne(query);
    if (!sponsorship) {
      res.status(404).json({ error: 'Patrocínio não encontrado' });
      return;
    }

    const { programName, description, timeRange, daysOfWeek, insertions, announcer, netPrice, isActive } = req.body;

    if (programName) sponsorship.programName = programName;
    if (description !== undefined) sponsorship.description = description;
    if (timeRange) sponsorship.timeRange = timeRange;
    if (daysOfWeek) {
      if (!Array.isArray(daysOfWeek) || daysOfWeek.length === 0 || !daysOfWeek.every((d: number) => d >= 0 && d <= 6)) {
        res.status(400).json({ error: 'daysOfWeek deve ser um array com valores de 0 (Dom) a 6 (Sáb)' });
        return;
      }
      sponsorship.daysOfWeek = daysOfWeek;
    }
    if (insertions) {
      if (!Array.isArray(insertions) || insertions.length === 0) {
        res.status(400).json({ error: 'Patrocínio deve ter pelo menos 1 inserção' });
        return;
      }
      sponsorship.insertions = insertions;
    }
    if (announcer !== undefined) sponsorship.announcer = announcer;
    if (isActive !== undefined) sponsorship.isActive = isActive;

    if (netPrice !== undefined) {
      const parsedNetPrice = parseFloat(netPrice);
      if (isNaN(parsedNetPrice) || parsedNetPrice <= 0) {
        res.status(400).json({ error: 'netPrice deve ser um valor positivo' });
        return;
      }
      sponsorship.netPrice = parsedNetPrice;
      sponsorship.pricePerMonth = Math.round(parsedNetPrice * (1 + PLATFORM_COMMISSION_RATE) * 100) / 100;
    }

    await sponsorship.save();

    await cacheInvalidate('sponsorship-marketplace:*');

    res.json({
      message: 'Patrocínio atualizado com sucesso!',
      sponsorship
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar patrocínio' });
  }
};

// Deletar patrocínio (Broadcaster ou Admin)
export const deleteSponsorship = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: 'Usuário não autenticado' });
      return;
    }

    const user = await User.findById(req.userId);
    if (!user || (user.userType !== 'broadcaster' && user.userType !== 'admin')) {
      res.status(403).json({ error: 'Apenas emissoras e administradores podem deletar patrocínios' });
      return;
    }

    const { id } = req.params;
    let query: any = { _id: id };

    if (user.userType === 'broadcaster') {
      query.broadcasterId = getEffectiveBroadcasterId(req);
    }

    const sponsorship = await Sponsorship.findOneAndDelete(query);
    if (!sponsorship) {
      res.status(404).json({ error: 'Patrocínio não encontrado' });
      return;
    }

    await cacheInvalidate('sponsorship-marketplace:*');

    res.json({ message: 'Patrocínio removido com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao deletar patrocínio' });
  }
};

// Listar patrocínios ativos para o marketplace (público)
export const getMarketplaceSponsorships = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { search, minPrice, maxPrice } = req.query;

    const cacheKey = buildCacheKey('sponsorship-marketplace', { search, minPrice, maxPrice });
    const cached = await cacheGet<any>(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    // Filtro de preço
    const priceFilter: any = {};
    if (minPrice) priceFilter.$gte = parseFloat(minPrice as string);
    if (maxPrice) priceFilter.$lte = parseFloat(maxPrice as string);

    const query: any = { isActive: true };
    if (Object.keys(priceFilter).length > 0) {
      query.pricePerMonth = priceFilter;
    }

    const sponsorships = await Sponsorship.find(query)
      .populate('broadcasterId', '_id companyName fantasyName broadcasterProfile address email status')
      .sort({ createdAt: -1 });

    // Filtra apenas de emissoras ativas/aprovadas
    const filtered = sponsorships.filter((sp: any) => {
      const b = sp.broadcasterId;
      if (!b || b.status !== 'approved') return false;

      if (search) {
        const searchLower = (search as string).toLowerCase();
        const nameMatch = (b.companyName || '').toLowerCase().includes(searchLower) ||
                          (b.fantasyName || '').toLowerCase().includes(searchLower);
        const programMatch = sp.programName.toLowerCase().includes(searchLower);
        return nameMatch || programMatch;
      }
      return true;
    });

    // Agrupa por broadcaster
    const byBroadcaster: Record<string, any> = {};
    for (const sp of filtered) {
      const b: any = sp.broadcasterId;
      const bId = b._id.toString();

      if (!byBroadcaster[bId]) {
        byBroadcaster[bId] = {
          broadcasterId: bId,
          broadcasterName: b.companyName || b.fantasyName || '',
          broadcasterDial: b.broadcasterProfile?.generalInfo?.dialFrequency || '',
          broadcasterBand: b.broadcasterProfile?.generalInfo?.band || '',
          broadcasterLogo: b.broadcasterProfile?.logo || '',
          broadcasterCity: b.address?.city || '',
          sponsorships: []
        };
      }

      byBroadcaster[bId].sponsorships.push({
        _id: sp._id,
        programName: sp.programName,
        description: sp.description,
        timeRange: sp.timeRange,
        daysOfWeek: sp.daysOfWeek,
        insertions: sp.insertions,
        announcer: sp.announcer,
        netPrice: sp.netPrice,
        pricePerMonth: sp.pricePerMonth,
        isActive: sp.isActive,
        createdAt: sp.createdAt
      });
    }

    const result = Object.values(byBroadcaster);

    await cacheSet(cacheKey, result, 30); // 30s cache

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar patrocínios do marketplace' });
  }
};
