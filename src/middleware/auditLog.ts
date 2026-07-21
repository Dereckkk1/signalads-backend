import { Response, NextFunction } from 'express';
import AuditLog from '../models/AuditLog';
import { AuthRequest } from './auth';
import { getClientIp } from '../utils/clientIp';

// Campos sensiveis que nunca devem ser logados.
// Comparacao por `includes` em lowercase — cobre variacoes como
// `userPassword`, `X-Api-Key`, `cardNumber`, `card_number`, etc.
const SENSITIVE_FIELDS = [
  'password',
  'token',
  'secret',
  'code',
  'twofactorcode',
  'apikey',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'cpforcnpj',
  'cpfcnpj',
  'cardnumber',
];

// Tokens curtos demais para `includes` (ex: "shipping".includes("pin")).
// Comparados por igualdade no nome normalizado.
const SENSITIVE_FIELDS_EXACT = ['pin', 'ccv', 'cvv', 'cvc'];

// Guarda de profundidade: objetos mais profundos que isso viram um marcador.
const MAX_FILTER_DEPTH = 6;
// Guarda de tamanho: arrays gigantes nao devem inflar o audit log.
const MAX_ARRAY_ITEMS = 50;

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[_-]/g, '');
  if (SENSITIVE_FIELDS_EXACT.includes(normalized)) return true;
  return SENSITIVE_FIELDS.some((field) => normalized.includes(field));
}

/**
 * Redige campos sensiveis recursivamente (objetos e arrays aninhados),
 * com guarda de profundidade e de ciclos.
 */
export function filterSensitiveFields(body: any, depth = 0, seen: WeakSet<object> = new WeakSet()): any {
  if (body === null || body === undefined) return body;
  if (typeof body !== 'object') return body;
  if (body instanceof Date) return body;
  if (depth >= MAX_FILTER_DEPTH) return '[MAX_DEPTH]';
  if (seen.has(body)) return '[CIRCULAR]';
  seen.add(body);

  if (Array.isArray(body)) {
    const items = body.slice(0, MAX_ARRAY_ITEMS).map((item) => filterSensitiveFields(item, depth + 1, seen));
    if (body.length > MAX_ARRAY_ITEMS) items.push('[TRUNCATED]');
    return items;
  }

  const filtered: Record<string, any> = {};
  for (const key of Object.keys(body)) {
    const value = (body as any)[key];
    if (value === undefined) continue; // undefined nao sobrevive ao Mongo — quebraria o hash
    filtered[key] = isSensitiveKey(key) ? '[REDACTED]' : filterSensitiveFields(value, depth + 1, seen);
  }
  return filtered;
}

// Tenta extrair userId do body de resposta (login retorna { user: { id } })
function extractUserIdFromResponse(body: any): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  if (body.user && (body.user.id || body.user._id)) {
    return String(body.user.id || body.user._id);
  }
  if (body.userId && typeof body.userId === 'string' && body.userId.length === 24) {
    return body.userId;
  }
  return undefined;
}

/**
 * Status 4xx que representam tentativa NEGADA e merecem trilha (FASE 9.1).
 * 400/409/422/429 ficam de fora de proposito: sao ruido de validacao/rate-limit
 * (o rate-limit ja tem monitoramento proprio) e inflariam a colecao.
 */
const DENIED_STATUSES = [401, 403, 404];

interface AuditLogOptions {
  // Quando true, registra mesmo sem req.userId (uso em rotas publicas como auth/login).
  // Tenta extrair userId do response body; se nao houver, registra sem userId.
  allowAnonymous?: boolean;
}

/**
 * Middleware factory para audit logging de acoes admin.
 * Intercepta res.json() e loga:
 *   - respostas de sucesso (2xx) → action original
 *   - tentativas negadas (401/403/404) → `${action}.denied`
 *
 * Regra de corte das negativas (evita volume):
 *   - o middleware so roda nas rotas onde foi montado explicitamente, entao
 *     404 de assets/rotas inexistentes nunca chegam aqui;
 *   - so registra quando ha ator identificado (req.userId) ou modo allowAnonymous
 *     (rotas de auth, onde a tentativa anonima e justamente o sinal);
 *   - 404 so e registrado quando a requisicao aponta para um recurso especifico
 *     (ha resourceId), que e o caso de enumeracao de IDs. 404 de listagem, nao.
 *
 * Uso em routes:
 *   router.put('/users/:id/status', authenticateToken, isAdmin, auditLog('user.status_change', 'user'), updateUserStatus);
 *   router.post('/login', auditLog('auth.login', 'user', { allowAnonymous: true }), login);
 */
export const auditLog = (action: string, resource: string, options: AuditLogOptions = {}) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const originalJson = res.json.bind(res);

    res.json = function (body: any) {
      const status = res.statusCode;
      const isSuccess = status >= 200 && status < 300;
      const resolvedUserId = req.userId || (options.allowAnonymous ? extractUserIdFromResponse(body) : undefined);
      const resourceId =
        req.params.broadcasterId ||
        req.params.orderId ||
        req.params.userId ||
        req.params.id ||
        req.params.productId ||
        req.params.ip;

      const hasActor = Boolean(resolvedUserId) || Boolean(options.allowAnonymous);
      const isDenied =
        DENIED_STATUSES.includes(status) && hasActor && (status !== 404 || Boolean(resourceId));

      if ((isSuccess && hasActor) || isDenied) {
        AuditLog.create({
          userId: resolvedUserId,
          action: isDenied ? `${action}.denied` : action,
          resource,
          resourceId,
          details: {
            requestBody: filterSensitiveFields(req.body),
            responseStatus: status,
            ...(isDenied ? { outcome: 'denied' } : {}),
          },
          ipAddress: getClientIp(req),
          userAgent: req.headers['user-agent'],
        }).catch(() => {});
      }

      return originalJson(body);
    };

    next();
  };
};
