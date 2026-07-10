/**
 * Gera `broadcasterProfile.slug` para todas as emissoras que ainda não têm.
 * Base do slug: "{stationName} {cidade} {dial}" slugificado, garantindo unicidade.
 *
 * Uso: `npm run slugs:generate` (ts-node). Idempotente — só toca emissoras sem slug.
 */
import mongoose from 'mongoose';
import 'dotenv/config';
import { User } from '../models/User';
import { generateUniqueSlug } from '../utils/slug';

export async function generateSlugs(): Promise<void> {
  const stations = await User.find({
    userType: 'broadcaster',
    'broadcasterProfile.slug': { $exists: false },
  });

  for (const u of stations) {
    const g = u.broadcasterProfile?.generalInfo ?? {};
    if (!g.stationName) continue;

    const base = `${g.stationName} ${u.address?.city ?? ''} ${g.dialFrequency ?? ''}`;
    const slug = await generateUniqueSlug(User, base, String(u._id));

    await User.updateOne(
      { _id: u._id },
      { $set: { 'broadcasterProfile.slug': slug } }
    );
  }
}

if (require.main === module) {
  mongoose
    .connect(process.env.MONGODB_URI as string)
    .then(generateSlugs)
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
