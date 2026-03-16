import { Request, Response, NextFunction } from 'express';

/**
 * CSRF Protection — Double-Submit Cookie Pattern
 *
 * Verifica que o header X-CSRF-Token corresponde ao cookie csrf_token.
 * Apenas requests mutantes (POST, PUT, DELETE, PATCH) sao verificadas.
 * Rotas publicas (login, registro, confirmacao de email, 2FA link, contato) sao isentas.
 */

// Rotas isentas de verificacao CSRF (endpoints publicos sem autenticacao)
const EXEMPT_ROUTES = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/confirm-email',
  '/api/auth/2fa/confirm',
  '/api/auth/refresh',
  '/api/contact-messages',
];

const isExempt = (path: string): boolean => {
  return EXEMPT_ROUTES.some(route => path === route || path.startsWith(route + '/'));
};

export const csrfProtection = (req: Request, res: Response, next: NextFunction): void => {
  // Apenas verifica requests mutantes
  const method = req.method.toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    next();
    return;
  }

  // Rotas isentas
  if (isExempt(req.path)) {
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
