import { Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { AuthRequest } from '../middleware/auth';
import { User } from '../models/User';
import { invalidateUserCache } from '../middleware/auth';
import { sendSalesTeamInvite } from '../services/emailService';

const MAX_SUB_USERS = 3;

/**
 * Retorna o broadcasterId efetivo (para manager = req.userId, para sales = parentBroadcasterId).
 */
function getEffectiveBroadcasterId(req: AuthRequest): string | null {
  if (req.user?.userType !== 'broadcaster') return null;
  if (req.user?.broadcasterRole === 'sales') {
    return req.user?.parentBroadcasterId?.toString() || null;
  }
  return req.userId || null;
}

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
 * GET /api/broadcaster/sub-users
 * Lista sub-usuarios da emissora.
 */
export const listSubUsers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireManager(req, res)) return;

    const subUsers = await User.find({
      parentBroadcasterId: req.userId,
      broadcasterRole: 'sales'
    })
      .select('name email phone cpfOrCnpj status createdAt emailConfirmed')
      .sort({ createdAt: -1 })
      .lean();

    res.json({ subUsers, maxSubUsers: MAX_SUB_USERS });
  } catch (error) {
    console.error('Erro ao listar sub-usuarios:', error);
    res.status(500).json({ error: 'Erro ao listar vendedores' });
  }
};

/**
 * POST /api/broadcaster/sub-users
 * Cria um sub-usuario (vendedor) para a emissora.
 * O sub-usuario recebe email com link para definir a senha.
 */
export const createSubUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireManager(req, res)) return;

    const { name, email, phone, cpfOrCnpj } = req.body;

    // Validar campos obrigatorios
    if (!name?.trim()) {
      res.status(400).json({ error: 'Nome e obrigatorio' });
      return;
    }
    if (!email?.trim()) {
      res.status(400).json({ error: 'Email e obrigatorio' });
      return;
    }
    if (!phone?.trim()) {
      res.status(400).json({ error: 'Telefone e obrigatorio' });
      return;
    }
    if (!cpfOrCnpj?.trim()) {
      res.status(400).json({ error: 'CPF/CNPJ e obrigatorio' });
      return;
    }

    // Verificar limite de sub-usuarios
    const currentCount = await User.countDocuments({
      parentBroadcasterId: req.userId,
      broadcasterRole: 'sales'
    });

    if (currentCount >= MAX_SUB_USERS) {
      res.status(400).json({ error: `Limite de ${MAX_SUB_USERS} vendedores atingido` });
      return;
    }

    // Verificar se email ja esta em uso
    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      res.status(400).json({ error: 'Este email ja esta em uso' });
      return;
    }

    // Gerar token de reset de senha (sub-user vai definir senha pelo link)
    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 dias

    // Senha temporaria (sera substituida pelo reset)
    const tempPassword = crypto.randomBytes(16).toString('hex');
    const hashedPassword = await bcrypt.hash(tempPassword, 12);

    const subUser = new User({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      phone: phone.trim(),
      cpfOrCnpj: cpfOrCnpj.trim(),
      password: hashedPassword,
      userType: 'broadcaster',
      broadcasterRole: 'sales',
      parentBroadcasterId: req.userId,
      status: 'approved',
      emailConfirmed: true, // Confiamos no email pois o manager informou
      passwordResetToken: resetToken,
      passwordResetTokenExpires: tokenExpires
    });

    await subUser.save();

    // Enviar email de convite
    const broadcasterName = req.user?.companyName || req.user?.fantasyName || 'Emissora';
    const inviterName = req.user?.name || req.user?.companyName || req.user?.fantasyName || 'Gerente';
    sendSalesTeamInvite(
      subUser.email,
      subUser.name || 'Vendedor',
      broadcasterName,
      inviterName,
      resetToken
    );

    res.status(201).json({
      subUser: {
        _id: subUser._id,
        name: subUser.name,
        email: subUser.email,
        phone: subUser.phone,
        cpfOrCnpj: subUser.cpfOrCnpj,
        status: subUser.status,
        createdAt: subUser.createdAt
      }
    });
  } catch (error) {
    console.error('Erro ao criar sub-usuario:', error);
    res.status(500).json({ error: 'Erro ao criar vendedor' });
  }
};

/**
 * PUT /api/broadcaster/sub-users/:id
 * Atualiza dados de um sub-usuario.
 */
export const updateSubUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireManager(req, res)) return;

    const { name, phone, cpfOrCnpj } = req.body;

    const subUser = await User.findOne({
      _id: req.params.id,
      parentBroadcasterId: req.userId,
      broadcasterRole: 'sales'
    });

    if (!subUser) {
      res.status(404).json({ error: 'Vendedor nao encontrado' });
      return;
    }

    if (name !== undefined) subUser.name = name.trim();
    if (phone !== undefined) subUser.phone = phone.trim();
    if (cpfOrCnpj !== undefined) subUser.cpfOrCnpj = cpfOrCnpj.trim();

    await subUser.save();
    await invalidateUserCache(subUser._id.toString());

    res.json({
      subUser: {
        _id: subUser._id,
        name: subUser.name,
        email: subUser.email,
        phone: subUser.phone,
        cpfOrCnpj: subUser.cpfOrCnpj,
        status: subUser.status,
        createdAt: subUser.createdAt
      }
    });
  } catch (error) {
    console.error('Erro ao atualizar sub-usuario:', error);
    res.status(500).json({ error: 'Erro ao atualizar vendedor' });
  }
};

/**
 * DELETE /api/broadcaster/sub-users/:id
 * Remove um sub-usuario.
 */
export const deleteSubUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireManager(req, res)) return;

    const subUser = await User.findOneAndDelete({
      _id: req.params.id,
      parentBroadcasterId: req.userId,
      broadcasterRole: 'sales'
    });

    if (!subUser) {
      res.status(404).json({ error: 'Vendedor nao encontrado' });
      return;
    }

    await invalidateUserCache(subUser._id.toString());

    res.json({ message: 'Vendedor removido com sucesso' });
  } catch (error) {
    console.error('Erro ao remover sub-usuario:', error);
    res.status(500).json({ error: 'Erro ao remover vendedor' });
  }
};

/**
 * POST /api/broadcaster/sub-users/:id/resend-invite
 * Reenvia email de convite (novo token de reset).
 */
export const resendInvite = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!requireManager(req, res)) return;

    const subUser = await User.findOne({
      _id: req.params.id,
      parentBroadcasterId: req.userId,
      broadcasterRole: 'sales'
    });

    if (!subUser) {
      res.status(404).json({ error: 'Vendedor nao encontrado' });
      return;
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    subUser.passwordResetToken = resetToken;
    subUser.passwordResetTokenExpires = tokenExpires;
    await subUser.save();

    const broadcasterName = req.user?.companyName || req.user?.fantasyName || 'Emissora';
    const inviterName = req.user?.name || req.user?.companyName || req.user?.fantasyName || 'Gerente';
    sendSalesTeamInvite(
      subUser.email,
      subUser.name || 'Vendedor',
      broadcasterName,
      inviterName,
      resetToken
    );

    res.json({ message: 'Convite reenviado com sucesso' });
  } catch (error) {
    console.error('Erro ao reenviar convite:', error);
    res.status(500).json({ error: 'Erro ao reenviar convite' });
  }
};

export { getEffectiveBroadcasterId };
