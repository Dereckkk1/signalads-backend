import { timingSafeEqual } from 'crypto';
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

// Rotas CSRF-isentas que ainda assim devem validar Origin/Referer.
// Sem isso, /login e /register ficam abertos a login-CSRF (a vitima e autenticada
// silenciosamente na conta do atacante) e /contact-messages a spam cross-site.
const ORIGIN_PROTECTED_EXEMPT_ROUTES = [
  '/api/auth/refresh',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/2fa/confirm',
  '/api/contact-messages',
];

/**
 * Compara dois tokens em tempo constante.
 *
 * `timingSafeEqual` exige buffers do MESMO tamanho — chamar com tamanhos
 * diferentes LANCA. Por isso o tamanho e conferido antes, e quando difere
 * fazemos um compare-dummy para nao criar um canal de timing pelo proprio
 * atalho ("tamanho errado" responderia mais rapido que "tamanho certo,
 * conteudo errado").
 */
function tokensIguais(a: string, b: string): boolean {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufB, bufB);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

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

  // Valida que header corresponde ao cookie, em TEMPO CONSTANTE (item 7.7).
  //
  // `!==` em string curto-circuita no primeiro byte diferente. O tempo de
  // resposta passa a depender de quantos caracteres iniciais o atacante
  // acertou, o que permite descobrir o token byte a byte com medicoes
  // repetidas. Aqui o valor tem 32 bytes aleatorios e o ataque e dificil na
  // pratica — mas comparacao de segredo em tempo constante e barata e nao
  // depende de o ataque ser "dificil o suficiente".
  if (!csrfFromHeader || !tokensIguais(csrfFromHeader, csrfFromCookie)) {
    res.status(403).json({ error: 'CSRF token inválido' });
    return;
  }

  next();
};
