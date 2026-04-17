import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import BroadcasterGroup, { ALL_PAGE_PERMISSIONS, PagePermission } from '../models/BroadcasterGroup';
import { User } from '../models/User';
import { invalidateUserCache } from '../middleware/auth';

/**
 * Verifica se o usuario logado e o manager da emissora.
 */
function requireManager(req: AuthRequest, res: Response): boolean {
  if (req.user?.userType !== 'broadcaster') {
    res.status(403).json({ error: 'Acesso restrito a emissoras' });
    return false;
  }
  if (req.user?.broadcasterRole === 'sales') {
    res.status(403).json({ error: 'Acesso restrito ao gerenciador da emissora' });
    return false;
  }
  return true;
}

/**
 * GET /api/broadcaster/groups
 * Lista todos os grupos da emissora.
 */
export const listGroups = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireManager(req, res)) return;

    const groups = await BroadcasterGroup.find({ broadcasterId: req.userId })
      .sort({ createdAt: -1 })
      .lean();

    // Para cada grupo, buscar quantos sub-usuarios estao atribuidos
    const groupIds = groups.map(g => g._id);
    const subUserCounts = await User.aggregate([
      { $match: { groupId: { $in: groupIds }, broadcasterRole: 'sales' } },
      { $group: { _id: '$groupId', count: { $sum: 1 } } }
    ]);

    const countMap: Record<string, number> = {};
    subUserCounts.forEach(({ _id, count }) => {
      countMap[_id.toString()] = count;
    });

    const enrichedGroups = groups.map(g => ({
      ...g,
      memberCount: countMap[g._id.toString()] || 0
    }));

    res.json({ groups: enrichedGroups });
  } catch (error) {
    console.error('Erro ao listar grupos:', error);
    res.status(500).json({ error: 'Erro ao listar grupos' });
  }
};

/**
 * POST /api/broadcaster/groups
 * Cria um novo grupo de permissoes.
 */
export const createGroup = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireManager(req, res)) return;

    const { name, permissions } = req.body;

    if (!name?.trim()) {
      res.status(400).json({ error: 'Nome do grupo é obrigatório' });
      return;
    }

    // Validar permissoes
    const validPermissions = (permissions || []).filter((p: string) =>
      (ALL_PAGE_PERMISSIONS as string[]).includes(p)
    ) as PagePermission[];

    // Verificar nome duplicado na emissora
    const existing = await BroadcasterGroup.findOne({
      broadcasterId: req.userId,
      name: { $regex: new RegExp(`^${name.trim()}$`, 'i') }
    });
    if (existing) {
      res.status(400).json({ error: 'Já existe um grupo com este nome' });
      return;
    }

    const group = new BroadcasterGroup({
      name: name.trim(),
      broadcasterId: req.userId,
      permissions: validPermissions
    });

    await group.save();

    res.status(201).json({ group: { ...group.toObject(), memberCount: 0 } });
  } catch (error) {
    console.error('Erro ao criar grupo:', error);
    res.status(500).json({ error: 'Erro ao criar grupo' });
  }
};

/**
 * PUT /api/broadcaster/groups/:id
 * Atualiza nome e/ou permissoes de um grupo.
 */
export const updateGroup = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireManager(req, res)) return;

    const group = await BroadcasterGroup.findOne({
      _id: req.params.id,
      broadcasterId: req.userId
    });

    if (!group) {
      res.status(404).json({ error: 'Grupo não encontrado' });
      return;
    }

    const { name, permissions } = req.body;

    if (name !== undefined) {
      if (!name.trim()) {
        res.status(400).json({ error: 'Nome do grupo não pode ser vazio' });
        return;
      }
      // Verificar duplicidade (exceto o proprio grupo)
      const duplicate = await BroadcasterGroup.findOne({
        broadcasterId: req.userId,
        name: { $regex: new RegExp(`^${name.trim()}$`, 'i') },
        _id: { $ne: group._id }
      });
      if (duplicate) {
        res.status(400).json({ error: 'Já existe um grupo com este nome' });
        return;
      }
      group.name = name.trim();
    }

    if (permissions !== undefined) {
      group.permissions = (permissions as string[]).filter((p: string) =>
        (ALL_PAGE_PERMISSIONS as string[]).includes(p)
      ) as PagePermission[];
    }

    await group.save();

    // Invalidar cache de todos os sub-usuarios do grupo para que as novas permissoes
    // sejam carregadas na proxima chamada a /me
    const affectedUsers = await User.find({ groupId: group._id }).select('_id').lean();
    await Promise.all(affectedUsers.map(u => invalidateUserCache(u._id.toString())));

    const memberCount = await User.countDocuments({ groupId: group._id, broadcasterRole: 'sales' });

    res.json({ group: { ...group.toObject(), memberCount } });
  } catch (error) {
    console.error('Erro ao atualizar grupo:', error);
    res.status(500).json({ error: 'Erro ao atualizar grupo' });
  }
};

/**
 * DELETE /api/broadcaster/groups/:id
 * Remove um grupo. Sub-usuarios atribuidos ficam sem grupo (acesso padrao).
 */
export const deleteGroup = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireManager(req, res)) return;

    const group = await BroadcasterGroup.findOneAndDelete({
      _id: req.params.id,
      broadcasterId: req.userId
    });

    if (!group) {
      res.status(404).json({ error: 'Grupo não encontrado' });
      return;
    }

    // Remover referencia do grupo nos sub-usuarios
    await User.updateMany(
      { groupId: group._id },
      { $unset: { groupId: '' } }
    );

    // Invalidar cache dos sub-usuarios afetados
    const affectedUsers = await User.find({
      parentBroadcasterId: req.userId,
      broadcasterRole: 'sales'
    }).select('_id').lean();
    await Promise.all(affectedUsers.map(u => invalidateUserCache(u._id.toString())));

    res.json({ message: 'Grupo removido com sucesso' });
  } catch (error) {
    console.error('Erro ao remover grupo:', error);
    res.status(500).json({ error: 'Erro ao remover grupo' });
  }
};
