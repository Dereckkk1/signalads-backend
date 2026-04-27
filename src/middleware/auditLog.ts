import { Response, NextFunction } from 'express';
import AuditLog from '../models/AuditLog';
import { AuthRequest } from './auth';

// Campos sensiveis que nunca devem ser logados
const SENSITIVE_FIELDS = ['password', 'newPassword', 'currentPassword', 'token', 'secret'];
function filterSensitiveFields(body: any): any {
  if (!body || typeof body !== 'object') return body;
  const filtered = { ...body };
  for (const field of SENSITIVE_FIELDS) {
    if (field in filtered) filtered[field] = '[REDACTED]';
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

interface AuditLogOptions {
  // Quando true, registra mesmo sem req.userId (uso em rotas publicas como auth/login).
  // Tenta extrair userId do response body; se nao houver, registra sem userId.
  allowAnonymous?: boolean;
}

/**
 * Middleware factory para audit logging de acoes admin.
 * Intercepta res.json() e loga apenas respostas de sucesso (2xx).
 *
 * Uso em routes:
 *   router.put('/users/:id/status', authenticateToken, isAdmin, auditLog('user.status_change', 'user'), updateUserStatus);
 *   router.post('/login', auditLog('auth.login', 'user', { allowAnonymous: true }), login);
 */
export const auditLog = (action: string, resource: string, options: AuditLogOptions = {}) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const originalJson = res.json.bind(res);

    res.json = function (body: any) {
      const isSuccess = res.statusCode >= 200 && res.statusCode < 300;
      const resolvedUserId = req.userId || (options.allowAnonymous ? extractUserIdFromResponse(body) : undefined);

      // Loga apenas acoes bem-sucedidas. Sem userId so e permitido em modo allowAnonymous.
      if (isSuccess && (resolvedUserId || options.allowAnonymous)) {
        AuditLog.create({
          userId: resolvedUserId,
          action,
          resource,
          resourceId: req.params.broadcasterId || req.params.orderId || req.params.userId || req.params.id,
          details: {
            requestBody: filterSensitiveFields(req.body),
            responseStatus: res.statusCode,
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        }).catch(() => {});
      }

      return originalJson(body);
    };

    next();
  };
};
