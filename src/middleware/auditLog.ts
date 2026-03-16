import { Response, NextFunction } from 'express';
import AuditLog from '../models/AuditLog';
import { AuthRequest } from './auth';

/**
 * Middleware factory para audit logging de acoes admin.
 * Intercepta res.json() e loga apenas respostas de sucesso (2xx).
 *
 * Uso em routes:
 *   router.put('/users/:id/status', authenticateToken, isAdmin, auditLog('user.status_change', 'user'), updateUserStatus);
 */
export const auditLog = (action: string, resource: string) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const originalJson = res.json.bind(res);

    res.json = function (body: any) {
      // Loga apenas acoes bem-sucedidas
      if (res.statusCode >= 200 && res.statusCode < 300 && req.userId) {
        AuditLog.create({
          userId: req.userId,
          action,
          resource,
          resourceId: req.params.broadcasterId || req.params.orderId || req.params.userId || req.params.id,
          details: {
            requestBody: req.body,
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
