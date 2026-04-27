import jwt from 'jsonwebtoken';
import { redis } from '../config/redis';

/**
 * Redis-backed JWT denylist.
 * Used to revoke individual access tokens by `jti` (JWT ID) on logout,
 * password change, admin reset, and account suspension.
 *
 * Tokens are still validated by signature/expiry first; the denylist is
 * an additional check after `jwt.verify`. TTL == remaining token lifetime
 * so Redis prunes entries automatically when the underlying JWT expires.
 */

const KEY_PREFIX = 'auth:denyJti:';

/**
 * Adds a JWT id to the denylist with the given TTL (seconds).
 * If ttlSec <= 0 the token is already expired; we skip the write.
 */
export async function denyJti(jti: string, ttlSec: number): Promise<void> {
  if (!jti || ttlSec <= 0) return;
  try {
    await redis.set(`${KEY_PREFIX}${jti}`, '1', 'EX', Math.ceil(ttlSec));
  } catch {
    // Falha de cache nao deve quebrar a app — log already emitted by redis client
  }
}

/**
 * Returns true if the given jti has been explicitly revoked.
 */
export async function isJtiDenied(jti: string): Promise<boolean> {
  if (!jti) return false;
  try {
    const exists = await redis.exists(`${KEY_PREFIX}${jti}`);
    return exists === 1;
  } catch {
    // Em caso de falha de Redis: fail-open (permite passar) — auth ainda eh validada
    // por assinatura/expiry. Alternativa fail-closed bloquearia todo o sistema
    // em case de Redis offline.
    return false;
  }
}

/**
 * Decodifica payload de access_token sem verificar assinatura.
 * Util para extrair `jti`/`exp` antes de chamar `denyJti` em logout/revogacao —
 * o token ja foi verificado pelo middleware `authenticateToken` neste ponto,
 * entao nao precisamos verificar dnv.
 */
export function unsafeDecodeAccessToken(token: string): { jti?: string; exp?: number; userId?: string } | null {
  try {
    const decoded = jwt.decode(token);
    if (!decoded || typeof decoded !== 'object') return null;
    return decoded as { jti?: string; exp?: number; userId?: string };
  } catch {
    return null;
  }
}

/**
 * Helper: dado um access_token (ou null), revoga seu jti com TTL == tempo restante.
 * Idempotente — pode ser chamado mesmo que o token nao exista ou esteja expirado.
 */
export async function denyAccessToken(token: string | undefined | null): Promise<void> {
  if (!token) return;
  const decoded = unsafeDecodeAccessToken(token);
  if (!decoded?.jti || !decoded?.exp) return;
  const nowSec = Math.floor(Date.now() / 1000);
  const ttlSec = decoded.exp - nowSec;
  await denyJti(decoded.jti, ttlSec);
}

/**
 * Marca um "iat floor" para um usuario: qualquer access token com `iat < floor`
 * deve ser rejeitado. Usado em fluxos onde nao temos acesso ao token atual da
 * vitima (ex: admin reset password de outro usuario, ban) mas precisamos
 * invalidar TODOS os access tokens existentes do usuario.
 *
 * TTL == tempo de vida maximo de um access token (15min) — apos isso, todos
 * os tokens pre-existentes ja terao expirado naturalmente.
 */
const IAT_FLOOR_PREFIX = 'auth:iatFloor:';
const IAT_FLOOR_TTL_SEC = 15 * 60; // == ACCESS_TOKEN_EXPIRY (15min)

export async function setUserIatFloor(userId: string): Promise<void> {
  if (!userId) return;
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    await redis.set(`${IAT_FLOOR_PREFIX}${userId}`, String(nowSec), 'EX', IAT_FLOOR_TTL_SEC);
  } catch {
    // silencioso — nao quebra a app
  }
}

export async function getUserIatFloor(userId: string): Promise<number | null> {
  if (!userId) return null;
  try {
    const v = await redis.get(`${IAT_FLOOR_PREFIX}${userId}`);
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}
