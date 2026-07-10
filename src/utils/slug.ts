import type { Model } from 'mongoose';
import type { IUser } from '../models/User';

// Marcas diacríticas combinantes (U+0300–U+036F) removidas após NFD.
const DIACRITICS = /[̀-ͯ]/g;

/**
 * Converte um texto em slug URL-safe:
 * remove acentos (NFD), minúsculas, não-alfanumérico → hífen, sem hífens nas pontas.
 */
export const slugify = (s: string): string =>
  (s || '')
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * Gera um slug único em `broadcasterProfile.slug`, anexando -2, -3… até não colidir.
 * `excludeId` permite ignorar o próprio documento (útil ao regenerar slug em edição).
 */
export async function generateUniqueSlug(
  UserModel: Model<IUser>,
  baseString: string,
  excludeId?: string
): Promise<string> {
  const base = slugify(baseString);
  let slug = base;
  let i = 2;

  const buildQuery = (candidate: string): Record<string, unknown> => {
    const query: Record<string, unknown> = { 'broadcasterProfile.slug': candidate };
    if (excludeId) query._id = { $ne: excludeId };
    return query;
  };

  while (await UserModel.exists(buildQuery(slug))) {
    slug = `${base}-${i}`;
    i += 1;
  }

  return slug;
}
