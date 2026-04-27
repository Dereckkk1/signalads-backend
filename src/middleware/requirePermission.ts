import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import BroadcasterGroup, {
  DEFAULT_SALES_PERMISSIONS,
  PagePermission,
} from '../models/BroadcasterGroup';

/**
 * Middleware de RBAC para sub-usuarios de emissora.
 *
 * Comportamento:
 * - userType !== 'broadcaster': passa (outras roles tem suas proprias guards)
 * - broadcasterRole === 'manager' (ou ausente em broadcaster): passa (manager tem acesso total)
 * - broadcasterRole === 'sales': verifica `groupPermissions` (cache) ou
 *   busca o grupo do banco; cai em `DEFAULT_SALES_PERMISSIONS` se nao houver grupo.
 *
 * Retorna 403 com `{ error: 'Permissão insuficiente' }` se faltar a permissao.
 */
export function requirePermission(perm: PagePermission) {
  return async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      // Sem usuario autenticado, deixa o authenticateToken responder (ou 401)
      if (!req.user) {
        next();
        return;
      }

      // RBAC so se aplica a broadcasters; outros tipos seguem para suas proprias guards
      if (req.user.userType !== 'broadcaster') {
        next();
        return;
      }

      // Manager tem acesso total a recursos da emissora
      if (req.user.broadcasterRole !== 'sales') {
        next();
        return;
      }

      // Sales: tenta ler permissoes ja em cache no req.user
      let perms: PagePermission[] | undefined = (req.user as any).groupPermissions;

      // Se nao veio do cache, busca do grupo (caso tenha groupId)
      if (!perms) {
        const groupId = (req.user as any).groupId;
        if (groupId) {
          try {
            const group = await BroadcasterGroup.findById(groupId)
              .select('permissions')
              .lean();
            perms = (group?.permissions as PagePermission[]) || undefined;
          } catch {
            perms = undefined;
          }
        }
      }

      // Fallback: defaults documentados para sales sem grupo
      if (!perms) {
        perms = DEFAULT_SALES_PERMISSIONS;
      }

      if (!perms.includes(perm)) {
        res.status(403).json({ error: 'Permissão insuficiente' });
        return;
      }

      next();
    } catch (err) {
      // Falha de leitura nao deve abrir o sistema; default-deny
      res.status(403).json({ error: 'Permissão insuficiente' });
    }
  };
}

export default requirePermission;
