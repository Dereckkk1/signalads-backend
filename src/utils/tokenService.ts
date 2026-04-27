import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Response, Request } from 'express';
import RefreshToken from '../models/RefreshToken';

const isProduction = process.env.NODE_ENV !== 'development';
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || undefined;
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

/**
 * Gera access token JWT (curta duracao: 15min).
 * Inclui `jti` aleatorio para suportar revogacao individual via denylist
 * (logout, troca de senha, reset por admin).
 */
export const generateAccessToken = (userId: string): string => {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) throw new Error('JWT_SECRET não está definido');
  const jti = crypto.randomUUID();
  return jwt.sign({ userId, jti }, jwtSecret, { expiresIn: ACCESS_TOKEN_EXPIRY });
};

/**
 * Gera refresh token (longa duracao: 7 dias)
 * Salva hash no banco — o token raw e enviado ao cliente via cookie
 */
export const generateRefreshToken = async (userId: string, req: Request): Promise<{ rawToken: string; family: string }> => {
  const rawToken = crypto.randomBytes(40).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
  const family = crypto.randomBytes(16).toString('hex');

  await RefreshToken.create({
    token: hashedToken,
    userId,
    family,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS),
    userAgent: req.headers['user-agent'],
    ipAddress: req.ip,
  });

  return { rawToken, family };
};

/**
 * Rotaciona refresh token — revoga o antigo e gera um novo na mesma familia
 * Se token reusado (ja revogado), revoga toda a familia (token roubado)
 */
export const rotateRefreshToken = async (rawToken: string, req: Request): Promise<{ accessToken: string; newRawRefresh: string } | null> => {
  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

  const existing = await RefreshToken.findOne({ token: hashedToken });
  if (!existing) return null;

  // Token ja foi revogado — possivel roubo, revoga toda a familia
  if (existing.revokedAt) {
    await RefreshToken.updateMany({ family: existing.family }, { revokedAt: new Date() });
    return null;
  }

  // Token expirado
  if (existing.expiresAt < new Date()) return null;

  // Revoga o token atual
  existing.revokedAt = new Date();
  await existing.save();

  // Gera novo par
  const newRawToken = crypto.randomBytes(40).toString('hex');
  const newHashedToken = crypto.createHash('sha256').update(newRawToken).digest('hex');

  await RefreshToken.create({
    token: newHashedToken,
    userId: existing.userId,
    family: existing.family,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS),
    userAgent: req.headers['user-agent'],
    ipAddress: req.ip,
  });

  const accessToken = generateAccessToken(existing.userId.toString());

  return { accessToken, newRawRefresh: newRawToken };
};

/**
 * Seta cookies httpOnly de autenticacao na resposta
 */
export const setAuthCookies = (res: Response, accessToken: string, refreshToken: string): void => {
  // Access token — curta duracao, enviado em todas as requests
  res.cookie('access_token', accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 15 * 60 * 1000, // 15min
    path: '/',
    ...(COOKIE_DOMAIN && { domain: COOKIE_DOMAIN }),
  });

  // Refresh token — longa duracao, enviado apenas para /api/auth/refresh
  res.cookie('refresh_token', refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: REFRESH_TOKEN_EXPIRY_MS,
    path: '/api/auth/refresh',
    ...(COOKIE_DOMAIN && { domain: COOKIE_DOMAIN }),
  });

  // CSRF token — legivel por JS para protecao double-submit
  const csrfToken = crypto.randomBytes(32).toString('hex');
  res.cookie('csrf_token', csrfToken, {
    httpOnly: false, // JS precisa ler
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 15 * 60 * 1000,
    path: '/',
    ...(COOKIE_DOMAIN && { domain: COOKIE_DOMAIN }),
  });
};

/**
 * Limpa cookies de autenticacao
 */
export const clearAuthCookies = (res: Response): void => {
  res.clearCookie('access_token', { path: '/' });
  res.clearCookie('refresh_token', { path: '/api/auth/refresh' });
  res.clearCookie('csrf_token', { path: '/' });
};

/**
 * Revoga todos os refresh tokens de um usuario (ex: logout total)
 */
export const revokeAllUserTokens = async (userId: string): Promise<void> => {
  await RefreshToken.updateMany(
    { userId, revokedAt: { $exists: false } },
    { revokedAt: new Date() }
  );
};
