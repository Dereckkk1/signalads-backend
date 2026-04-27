import { Request, Response, NextFunction } from 'express';

/**
 * CSRF Protection — Double-Submit Cookie Pattern
 *
 * Verifica que o header X-CSRF-Token corresponde ao cookie csrf_token.
 * Apenas requests mutantes (POST, PUT, DELETE, PATCH) sao verificadas.
 * Rotas publicas (login, registro, confirmacao de email, 2FA link, contato) sao isentas.
 */

// Rotas isentas de verificacao CSRF
const EXEMPT_ROUTES = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/confirm-email',
  '/api/auth/2fa/confirm',
  '/api/auth/refresh',
  '/api/auth/logout',      // Logout deve funcionar mesmo com CSRF expirado
  '/api/contact-messages',
  '/api/vitals',           // sendBeacon nao envia headers customizados
];

const isExempt = (path: string): boolean => {
  return EXEMPT_ROUTES.some(route => path === route || path.startsWith(route + '/'));
};

// Origens permitidas para validacao do header Origin/Referer em rotas CSRF-isentas
// Mantem em sincronia com `allowedOrigins` em src/index.ts.
const productionOrigins = [
  'https://eradios.com.br',
  'https://www.eradios.com.br',
  'https://api.eradios.com.br',
];
const devOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5000',
];
const ALLOWED_ORIGINS = process.env.NODE_ENV === 'production'
  ? productionOrigins
  : [...productionOrigins, ...devOrigins];

/**
 * Verifica que o header Origin (ou Referer) esta na allowlist.
 * Se ausente (same-origin server-to-server / curl), aceita — apenas BLOQUEIA quando
 * o navegador ENVIA um Origin que nao bate com a allowlist.
 *
 * Belt-and-suspenders para rotas CSRF-isentas que mutam estado (ex: /api/auth/refresh).
 * Sem isso, mesmo com SameSite=Lax, qualquer mudanca futura (sameSite=None, subdominio
 * comprometido) abre brecha de CSRF nesses endpoints.
 */
const isOriginAllowed = (req: Request): boolean => {
  const origin = req.headers.origin as string | undefined;
  if (origin) {
    return ALLOWED_ORIGINS.includes(origin);
  }
  // Sem Origin: verifica Referer (alguns clientes nao enviam Origin)
  const referer = req.headers.referer as string | undefined;
  if (referer) {
    try {
      const refUrl = new URL(referer);
      const refOrigin = `${refUrl.protocol}//${refUrl.host}`;
      return ALLOWED_ORIGINS.includes(refOrigin);
    } catch {
      return false;
    }
  }
  // Nem Origin nem Referer: requisicao server-to-server / curl. Permite.
  return true;
};

// Rotas CSRF-isentas que ainda assim devem validar Origin/Referer
const ORIGIN_PROTECTED_EXEMPT_ROUTES = [
  '/api/auth/refresh',
];

const requiresOriginCheck = (path: string): boolean => {
  return ORIGIN_PROTECTED_EXEMPT_ROUTES.some(route => path === route || path.startsWith(route + '/'));
};

export const csrfProtection = (req: Request, res: Response, next: NextFunction): void => {
  // Apenas verifica requests mutantes
  const method = req.method.toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    next();
    return;
  }

  // Rotas isentas — mas algumas (ex: /api/auth/refresh) ainda validam Origin/Referer
  if (isExempt(req.path)) {
    if (requiresOriginCheck(req.path) && !isOriginAllowed(req)) {
      res.status(403).json({ error: 'Origem nao permitida' });
      return;
    }
    next();
    return;
  }

  const csrfFromCookie = req.cookies?.csrf_token;
  const csrfFromHeader = req.headers['x-csrf-token'] as string | undefined;
  const hasAccessToken = !!req.cookies?.access_token;

  // Se usuario esta autenticado (tem access_token), CSRF e obrigatorio
  if (hasAccessToken && !csrfFromCookie) {
    res.status(403).json({ error: 'CSRF token ausente' });
    return;
  }

  // Se nao esta autenticado e nao tem CSRF cookie, permite (request publico)
  if (!hasAccessToken && !csrfFromCookie) {
    next();
    return;
  }

  // Valida que header corresponde ao cookie
  if (!csrfFromHeader || csrfFromHeader !== csrfFromCookie) {
    res.status(403).json({ error: 'CSRF token inválido' });
    return;
  }

  next();
};
