/**
 * Backfill de coordenadas (`address.latitude/longitude`) das emissoras que ainda não têm.
 * Base do sort por proximidade do marketplace (ver `productController.getAllActiveProducts`).
 * Geocodifica a cidade (centroide) via OpenStreetMap/Nominatim.
 *
 * Idempotente — só toca emissoras sem coordenada. Cacheia por cidade em memória e
 * respeita o rate limit do Nominatim (~1 req/s) entre geocodes distintos.
 *
 * Uso: `npm run coords:backfill` (ts-node).
 */
import mongoose from 'mongoose';
import 'dotenv/config';
import { User } from '../models/User';
import { geocodeCityCoords } from '../utils/geocode';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function backfillBroadcasterCoords(): Promise<void> {
  // Emissoras com cidade preenchida mas sem lat/lng (campo null ou ausente).
  const stations = await User.find({
    userType: 'broadcaster',
    'address.city': { $nin: [null, ''] },
    $or: [
      { 'address.latitude': null },
      { 'address.longitude': null },
    ],
  }).select('_id address');

  console.log(`[coords:backfill] ${stations.length} emissoras sem coordenada.`);

  // Cacheia por "cidade|uf" — muitas emissoras compartilham cidade (1 geocode por cidade).
  const cityCache = new Map<string, { latitude: number; longitude: number } | null>();
  let updated = 0;
  let failed = 0;

  for (const u of stations) {
    const city = u.address?.city?.trim();
    const state = u.address?.state?.trim();
    if (!city) continue;

    const key = `${city.toLowerCase()}|${(state || '').toLowerCase()}`;
    let coords = cityCache.get(key);
    if (coords === undefined) {
      coords = await geocodeCityCoords(city, state);
      cityCache.set(key, coords);
      await sleep(1100); // respeita o rate limit do Nominatim (~1 req/s)
    }

    if (coords) {
      await User.updateOne(
        { _id: u._id },
        { $set: { 'address.latitude': coords.latitude, 'address.longitude': coords.longitude } }
      );
      updated++;
    } else {
      failed++;
      console.warn(`[coords:backfill] sem geocode para "${city}, ${state || ''}" (emissora ${u._id})`);
    }
  }

  console.log(`[coords:backfill] concluído: ${updated} atualizadas, ${failed} sem geocode.`);
}

if (require.main === module) {
  mongoose
    .connect(process.env.MONGODB_URI as string)
    .then(backfillBroadcasterCoords)
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
