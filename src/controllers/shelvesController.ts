import { Response } from 'express';
import { Types } from 'mongoose';
import { User } from '../models/User';
import { Product } from '../models/Product';
import { AuthRequest } from '../middleware/auth';
import { campaignCountsByBroadcaster } from '../services/socialProofService';
import { earliestOnAirDate } from '../utils/businessDays';

// Emissora ativa no marketplace: aprovada OU catálogo (cadastrada pelo admin).
const ACTIVE_BROADCASTER = {
  userType: 'broadcaster',
  $or: [{ status: 'approved' }, { isCatalogOnly: true }],
};

/** Monta os cards do marketplace (mesma anatomia usada no RadioCard). */
async function toCards(users: any[]) {
  const ids = users.map((u) => u._id);
  if (ids.length === 0) return [];

  const [products, counts] = await Promise.all([
    Product.find({ broadcasterId: { $in: ids }, isActive: true })
      .select('broadcasterId pricePerInsertion')
      .lean(),
    campaignCountsByBroadcaster(ids.map((id: any) => String(id))),
  ]);

  const minPrice: Record<string, number> = {};
  for (const p of products as any[]) {
    const k = String(p.broadcasterId);
    const cur = minPrice[k];
    if (cur === undefined || p.pricePerInsertion < cur) minPrice[k] = p.pricePerInsertion;
  }

  const onAir = earliestOnAirDate().toISOString().slice(0, 10);

  return users
    .filter((u) => String(u._id) in minPrice) // só emissoras compráveis (com produto ativo)
    .map((u) => {
      const g = u.broadcasterProfile?.generalInfo ?? {};
      const pop = u.broadcasterProfile?.coverage?.totalPopulation ?? 0;
      const price = minPrice[String(u._id)] as number; // garantido pelo filter acima
      return {
        broadcasterId: u._id,
        stationName: g.stationName,
        dialFrequency: g.dialFrequency,
        band: g.band,
        streamingUrl: g.streamingUrl || null,
        logo: u.broadcasterProfile?.logo ?? u.logo ?? null,
        city: u.address?.city,
        state: u.address?.state,
        categories: u.broadcasterProfile?.categories ?? [],
        totalPopulation: pop,
        pmm: u.broadcasterProfile?.pmm ?? 0,
        minPrice: price,
        cpm: pop > 0 ? Number((price / (pop / 1000)).toFixed(2)) : null,
        campaignsCount: counts[String(u._id)] ?? 0,
        earliestOnAir: onAir,
      };
    });
}

/**
 * GET /api/products/marketplace/shelves?city=&state=
 * Líderes da região (pmm desc) + dial (ordenado por frequência). Fallback p/ estado
 * quando a cidade não tem emissoras.
 */
export const getShelves = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { city, state } = req.query as { city?: string; state?: string };
    if (!city && !state) {
      res.status(400).json({ error: 'Informe city e/ou state' });
      return;
    }

    let fallback: 'city' | 'state' = 'city';
    let users: any[] = [];
    if (city) {
      users = await User.find({ ...ACTIVE_BROADCASTER, 'address.city': city })
        .sort({ 'broadcasterProfile.pmm': -1 })
        .limit(12)
        .lean();
    }
    if (users.length === 0 && state) {
      fallback = 'state';
      users = await User.find({ ...ACTIVE_BROADCASTER, 'address.state': state })
        .sort({ 'broadcasterProfile.pmm': -1 })
        .limit(12)
        .lean();
    }

    const cards = await toCards(users);
    const dial = [...cards]
      .filter((c) => c.dialFrequency)
      .sort((a, b) => parseFloat(a.dialFrequency) - parseFloat(b.dialFrequency))
      .slice(0, 8);

    res.json({
      region: { city: city ?? null, state: state ?? null },
      fallback,
      total: cards.length,
      leaders: cards.slice(0, 3),
      dial,
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao carregar shelves do marketplace' });
  }
};

/**
 * GET /api/products/marketplace/similar?ids=<id1>,<id2>
 * Emissoras parecidas com as já vistas (mesma categoria ou estado), com o motivo.
 */
export const getSimilar = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const raw = String(req.query.ids ?? '');
    const ids = raw.split(',').filter(Boolean);
    if (ids.length === 0 || ids.some((id) => !Types.ObjectId.isValid(id))) {
      res.status(400).json({ error: 'Parâmetro ids inválido' });
      return;
    }

    const seen = await User.find({ _id: { $in: ids } }).lean();
    if (seen.length === 0) {
      res.json({ items: [] });
      return;
    }

    const cats = [...new Set(seen.flatMap((s: any) => s.broadcasterProfile?.categories ?? []))];
    const states = [...new Set(seen.map((s: any) => s.address?.state).filter(Boolean))];

    const candidates = await User.find({
      ...ACTIVE_BROADCASTER,
      _id: { $nin: ids },
      $or: [
        { 'broadcasterProfile.categories': { $in: cats } },
        { 'address.state': { $in: states } },
      ],
    })
      .sort({ 'broadcasterProfile.pmm': -1 })
      .limit(6)
      .lean();

    const cards = (await toCards(candidates)).slice(0, 3);

    const reasonFor = (card: any) => {
      const match = seen.find((s: any) =>
        (s.broadcasterProfile?.categories ?? []).some((c: string) => card.categories.includes(c)));
      return match
        ? { type: 'audience', refName: match.broadcasterProfile?.generalInfo?.stationName }
        : { type: 'region', refName: seen[0]?.broadcasterProfile?.generalInfo?.stationName };
    };

    res.json({ items: cards.map((c) => ({ ...c, reason: reasonFor(c) })) });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao carregar emissoras similares' });
  }
};
