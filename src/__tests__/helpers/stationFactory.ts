/**
 * Factory de emissora para testes de marketplace (shelves, similar, suggest).
 * Cria um broadcaster aprovado com generalInfo/categorias/cobertura e 1 produto ativo.
 * pricePerInsertion é explícito (required + recalculado no pre('save') = netPrice*1.25).
 */
import { createBroadcaster } from './authHelper';
import { User } from '../../models/User';
import { Product } from '../../models/Product';

type AudienceProfile = {
  gender?: { male: number; female: number };
  ageRange?: string;
  socialClass?: { classeAB: number; classeC: number; classeDE: number };
};

export async function seedStation(
  name: string,
  city: string,
  pmm: number,
  freq: string,
  cat = 'Hits',
  state = 'SC',
  audienceProfile?: AudienceProfile
) {
  const s = await createBroadcaster();
  await User.updateOne({ _id: s.user._id }, {
    $set: {
      'address.city': city,
      'address.state': state,
      broadcasterProfile: {
        generalInfo: { stationName: name, dialFrequency: freq, band: 'FM', streamingUrl: 'https://x/stream' },
        categories: [cat],
        coverage: { totalPopulation: pmm * 10000, cities: [city] },
        pmm,
        ...(audienceProfile ? { audienceProfile } : {}),
      },
    },
  });
  await Product.create({
    broadcasterId: s.user._id,
    spotType: 'Comercial 30s',
    duration: 30,
    timeSlot: '06:00-12:00',
    netPrice: 64.35,
    pricePerInsertion: 80.44,
    isActive: true,
  });
  return s;
}
