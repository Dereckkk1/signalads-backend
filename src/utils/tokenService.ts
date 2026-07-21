import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Response, Request } from 'express';
import RefreshToken from '../models/RefreshToken';
import { setUserIatFloor } from './jwtDenylist';

// Cookies `Secure` fora de dev/test. NAO usar `!== 'development'`: se NODE_ENV
// vier vazio ou errado em producao, a inversao silenciosamente derruba o Secure.
// Lista explicita dos ambientes SEM TLS (FASE 7.10).
const NON_SECURE_ENVS = ['development', 'test'];
const isProduction = !NON_SECURE_ENVS.includes(process.env.NODE_ENV || '');
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || undefined;
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

/**
 * Claims `iss`/`aud` do access token (FASE 7.6).
 * Emitidos na assinatura e EXIGIDOS na verificacao (`middleware/auth.ts`), o que
 * impede que um JWT assinado com o mesmo segredo por outro servico/ambiente
 * (ou um token antigo de outra finalidade) seja aceito como sessao da API.
 */
export const JWT_ISSUER = 'eradios-api';
export const JWT_AUDIENCE = 'eradios-web';

/**
 * FASE 7.10 — validacao do JWT_SECRET no boot.
 * Roda no import do modulo (que faz parte da cadeia de boot via rotas/controllers).
 * Em producao, aborta o processo: subir com segredo ausente/fraco significa que
 * todos os access tokens sao forjaveis, e falhar silenciosamente e pior que nao subir.
 */
const MIN_JWT_SECRET_LENGTH = 32;
export const assertJwtSecretStrength = (): void => {
  if (process.env.NODE_ENV !== 'production') return;
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET não está definido — obrigatório em produção');
  }
  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET muito curto (${secret.length} caracteres) — mínimo de ${MIN_JWT_SECRET_LENGTH} em produção`
    );
  }
};
assertJwtSecretStrength();

/**
 * Gera access token JWT (curta duracao: 15min).
 * Inclui `jti` aleatorio para suportar revogacao individual via denylist
 * (logout, troca de senha, reset por admin).
 */
export const generateAccessToken = (userId: string): string => {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) throw new Error('JWT_SECRET não está definido');
  const jti = crypto.randomUUID();
  return jwt.sign({ userId, jti }, jwtSecret, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
};

/**
 * Deriva o CSRF token a partir do `jti` do access token (FASE 7.7).
 *
 * Em vez de um valor aleatorio independente, o csrf_token passa a ser
 * HMAC(JWT_SECRET, jti): fica vinculado AQUELA sessao. Um token de CSRF
 * capturado/plantado de outra sessao deixa de ser aceitavel assim que o
 * middleware de CSRF recomputar o HMAC a partir do jti do access_token.
 */
export const deriveCsrfToken = (jti: string): string => {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) throw new Error('JWT_SECRET não está definido');
  return crypto.createHmac('sha256', jwtSecret).update(jti).digest('hex');
};

/** Extrai o `jti` de um access token ja assinado (sem re-verificar assinatura). */
const jtiOf = (accessToken: string): string | null => {
  try {
    const decoded = jwt.decode(accessToken) as { jti?: string } | null;
    return decoded?.jti || null;
  } catch {
    return null;
  }
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

  // Token ja foi revogado — possivel roubo, revoga toda a familia.
  // FASE 7.6: revogar a familia so mata os REFRESH tokens; o atacante (ou a
  // vitima) ainda carrega um access token valido por ate 15min. O iat floor
  // invalida imediatamente todos os access tokens ja emitidos para o usuario.
  if (existing.revokedAt) {
    await RefreshToken.updateMany({ family: existing.family }, { revokedAt: new Date() });
    await setUserIatFloor(existing.userId.toString()).catch(() => {});
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

  // CSRF token — legivel por JS para protecao double-submit.
  // Derivado do `jti` do access token (FASE 7.7) para ficar vinculado a sessao;
  // fallback aleatorio apenas se o token nao trouxer jti.
  const jti = jtiOf(accessToken);
  const csrfToken = jti ? deriveCsrfToken(jti) : crypto.randomBytes(32).toString('hex');
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
