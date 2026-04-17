import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { User } from '../models/User';
import BlockedDomain from '../models/BlockedDomain';
import BroadcasterGroup, { DEFAULT_SALES_PERMISSIONS, PagePermission } from '../models/BroadcasterGroup';
import { sendTwoFactorEnableEmail, sendTwoFactorLoginEmail, sendTwoFactorCodeEmail, sendEmailConfirmation, sendPasswordResetEmail } from '../services/emailService';
import { AuthRequest, invalidateUserCache } from '../middleware/auth';
import { isFreeEmailDomain, getEmailDomain } from '../utils/freeEmailDomains';
import { generateAccessToken, generateRefreshToken, setAuthCookies, clearAuthCookies, rotateRefreshToken, revokeAllUserTokens } from '../utils/tokenService';

/**
 * Retorna as permissoes de pagina efetivas de um sub-usuario.
 * Se tiver grupo, retorna as permissoes do grupo; caso contrario, DEFAULT_SALES_PERMISSIONS.
 */
async function getSalesPermissions(groupId?: any): Promise<PagePermission[]> {
  if (!groupId) return DEFAULT_SALES_PERMISSIONS;
  try {
    const group = await BroadcasterGroup.findById(groupId).select('permissions').lean();
    return (group?.permissions as PagePermission[]) || DEFAULT_SALES_PERMISSIONS;
  } catch {
    return DEFAULT_SALES_PERMISSIONS;
  }
}

// Validacao de senha forte — consistente em todo o backend
export const validatePasswordStrength = (password: string): string | null => {
  if (!password) return 'Senha é obrigatória';
  if (password.length < 10) return 'Senha deve ter no mínimo 10 caracteres';
  if (!/[A-Z]/.test(password)) return 'Senha deve conter ao menos uma letra maiúscula';
  if (!/[a-z]/.test(password)) return 'Senha deve conter ao menos uma letra minúscula';
  if (!/[0-9]/.test(password)) return 'Senha deve conter ao menos um número';
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) return 'Senha deve conter ao menos um caractere especial';
  return null;
};

/** Seta cookie de device fingerprint se nao existir (#31) */
function ensureDeviceFingerprintCookie(req: Request, res: Response): void {
  if (!req.cookies?.device_fp) {
    res.cookie('device_fp', crypto.randomBytes(32).toString('hex'), {
      httpOnly: true,
      secure: process.env.NODE_ENV !== 'development',
      sameSite: 'lax',
      maxAge: 365 * 24 * 60 * 60 * 1000,
      path: '/',
    });
  }
}

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, userType, cpfOrCnpj, companyName, fantasyName, phone, cnpj, address } = req.body;

    // ⚠️ Apenas advertiser e agency podem se auto-cadastrar
    if (!['advertiser', 'agency'].includes(userType)) {
      res.status(403).json({
        error: 'Tipo de conta não permitido para auto-cadastro. Entre em contato com o administrador.'
      });
      return;
    }

    // Validar email corporativo para anunciantes e agências
    if (userType === 'advertiser' || userType === 'agency') {
      // Verificar contra lista hardcoded de domínios gratuitos
      if (isFreeEmailDomain(email)) {
        res.status(400).json({
          error: 'Para cadastro empresarial, utilize seu email corporativo (ex: nome@suaempresa.com.br). Emails gratuitos como Gmail, Hotmail, Yahoo não são aceitos.'
        });
        return;
      }

      // Verificar contra domínios bloqueados pelo admin
      const domain = getEmailDomain(email);
      const blockedDomain = await BlockedDomain.findOne({ domain });
      if (blockedDomain) {
        res.status(400).json({
          error: 'Para cadastro empresarial, utilize seu email corporativo (ex: nome@suaempresa.com.br). Emails gratuitos como Gmail, Hotmail, Yahoo não são aceitos.'
        });
        return;
      }
    }

    // Verificar se usuario ja existe — mensagem generica para evitar enumeracao de contas
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      // Se existe mas nao confirmou email, reenvia silenciosamente
      if (!existingUser.emailConfirmed && existingUser.emailConfirmToken) {
        const confirmToken = crypto.randomBytes(32).toString('hex');
        const tokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

        existingUser.emailConfirmToken = confirmToken;
        existingUser.emailConfirmTokenExpires = tokenExpires;
        await existingUser.save();

        await sendEmailConfirmation(existingUser.email, existingUser.companyName || existingUser.fantasyName || 'Usuário', confirmToken);
      }

      // Mesma resposta generica para qualquer caso — previne account enumeration
      res.status(200).json({
        message: 'Se este email estiver disponível, você receberá um link de confirmação.',
        requiresEmailConfirmation: true
      });
      return;
    }

    // Validar forca da senha
    const passwordError = validatePasswordStrength(password);
    if (passwordError) {
      res.status(400).json({ error: passwordError });
      return;
    }

    // Hash da senha
    const hashedPassword = await bcrypt.hash(password, 12);

    // Gera token de confirmação de email
    const confirmToken = crypto.randomBytes(32).toString('hex');
    const tokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    // Criar usuário (apenas advertiser ou agency) - não confirmado ainda
    const user = new User({
      email,
      password: hashedPassword,
      userType,
      status: 'approved',
      cpfOrCnpj,
      companyName,
      fantasyName,
      phone,
      cnpj,
      address,
      emailConfirmed: false,
      emailConfirmToken: confirmToken,
      emailConfirmTokenExpires: tokenExpires,
      // 2FA desabilitado por padrão — usuário pode ativar nas configurações
      twoFactorEnabled: false,
    });

    await user.save();

    // Envia email de confirmação
    await sendEmailConfirmation(email, companyName || fantasyName || 'Usuário', confirmToken);

    res.status(201).json({
      message: 'Cadastro iniciado! Verifique seu email para confirmar sua conta.',
      requiresEmailConfirmation: true
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao cadastrar usuário' });
  }
};

export const confirmEmail = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.params;

    // Atomic operation to prevent race conditions (e.g. React StrictMode double-mount)
    const user = await User.findOneAndUpdate(
      {
        emailConfirmToken: token,
        emailConfirmTokenExpires: { $gt: new Date() }
      },
      {
        $set: { emailConfirmed: true },
        $unset: { emailConfirmToken: '', emailConfirmTokenExpires: '' }
      },
      { new: true }
    );

    if (!user) {
      res.status(400).json({ error: 'Link inválido ou expirado. Faça o cadastro novamente.' });
      return;
    }

    res.json({ message: 'Email confirmado com sucesso! Agora você pode fazer login.' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao confirmar email' });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { emailOrCnpj, password } = req.body;

    if (!emailOrCnpj) {
      res.status(400).json({ error: 'Email ou CNPJ é obrigatório' });
      return;
    }

    // Verifica se é email ou número (CNPJ/CPF)
    const isEmail = emailOrCnpj.includes('@');
    const searchQuery = isEmail
      ? { email: emailOrCnpj }
      : { cpfOrCnpj: emailOrCnpj };

    // Buscar usuário por email ou CNPJ/CPF
    const user = await User.findOne(searchQuery);

    if (!user) {
      res.status(401).json({ error: 'Credenciais inválidas' });
      return;
    }

    // Verificar senha
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      res.status(401).json({ error: 'Credenciais inválidas' });
      return;
    }

    // Verificar se email foi confirmado — mensagem generica para nao revelar estado da conta
    if (user.emailConfirmed === false) {
      res.status(401).json({
        error: 'email_not_confirmed',
        message: 'Credenciais inválidas ou email não confirmado. Verifique sua caixa de entrada.'
      });
      return;
    }

    // Verificar ban — mensagem generica (nao revelar status exato da conta)
    if (user.status === 'rejected') {
      res.status(401).json({
        error: 'Credenciais inválidas'
      });
      return;
    }

    // Verificar se 2FA está habilitado
    if (user.twoFactorEnabled && user.twoFactorConfirmedAt) {

      // Device fingerprint: cookie persistente + user-agent + IP (#31)
      const userAgent = req.headers['user-agent'] || 'unknown';
      const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
      const cookieFingerprint = req.cookies?.device_fp || '';
      const deviceId = crypto.createHash('sha256').update(`${cookieFingerprint}${userAgent}${ipAddress}`).digest('hex');

      // Trusted device expiry: 90 dias (#32)
      const TRUSTED_DEVICE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
      const isTrustedDevice = user.trustedDevices?.some(d => {
        if (d.deviceId !== deviceId) return false;
        const createdAt = d.createdAt ? new Date(d.createdAt).getTime() : 0;
        return (Date.now() - createdAt) < TRUSTED_DEVICE_TTL_MS;
      });

      if (isTrustedDevice) {
        // Atualiza lastUsed do dispositivo
        if (user.trustedDevices && user.trustedDevices.length > 0) {
          const deviceIndex = user.trustedDevices.findIndex(d => d.deviceId === deviceId);
          if (deviceIndex !== -1 && user.trustedDevices[deviceIndex]) {
            user.trustedDevices[deviceIndex].lastUsed = new Date();
            await user.save();
          }
        }
      } else {

        // Cooldown por email: impede envio de multiplos codigos em menos de 60s
        if (user.twoFactorCodeExpires && user.twoFactorCode) {
          const codeCreatedAt = new Date(user.twoFactorCodeExpires.getTime() - 10 * 60 * 1000); // expiry - 10min = created
          const secondsSinceLastCode = (Date.now() - codeCreatedAt.getTime()) / 1000;
          if (secondsSinceLastCode < 60) {
            res.json({
              requiresTwoFactor: true,
              message: 'Código de verificação já enviado. Verifique seu email.',
              userId: user.twoFactorSessionToken
            });
            return;
          }
        }

        // Gera código de 6 dígitos
        const twoFactorCode = crypto.randomInt(100000, 999999).toString();
        const codeExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutos

        // Hash do codigo antes de salvar no banco — protege contra leak de DB
        const codeHash = crypto.createHash('sha256').update(twoFactorCode).digest('hex');
        user.twoFactorCode = codeHash;
        user.twoFactorCodeExpires = codeExpires;
        await user.save();

        // Envia email com código em plaintext (hash fica no banco)
        await sendTwoFactorCodeEmail(user.email, user.name || user.companyName || 'Usuário', twoFactorCode);

        // Token opaco em vez de ObjectId real — evita enumeracao de usuarios
        const twoFactorSessionToken = crypto.randomBytes(32).toString('hex');
        user.twoFactorSessionToken = twoFactorSessionToken;
        user.twoFactorAttempts = 0;
        await user.save();

        res.json({
          requiresTwoFactor: true,
          message: 'Código de verificação enviado para seu email',
          userId: twoFactorSessionToken
        });
        return;
      }
    }

    // Device fingerprint + tokens (access 15min + refresh 7d em cookies httpOnly)
    ensureDeviceFingerprintCookie(req, res);
    const accessToken = generateAccessToken(user._id.toString());
    const { rawToken: refreshTokenRaw } = await generateRefreshToken(user._id.toString(), req);
    setAuthCookies(res, accessToken, refreshTokenRaw);

    // Para sub-usuarios (sales), buscar permissoes do grupo
    let loginGroupPermissions: PagePermission[] | undefined;
    if (user.broadcasterRole === 'sales') {
      loginGroupPermissions = await getSalesPermissions(user.groupId);
    }

    res.json({
      message: 'Login realizado com sucesso!',
      user: {
        id: user._id,
        email: user.email,
        userType: user.userType,
        status: user.status,
        companyName: user.companyName,
        fantasyName: user.fantasyName,
        phone: user.phone,
        cpfOrCnpj: user.cpfOrCnpj,
        cnpj: user.cnpj,
        address: user.address,
        onboardingCompleted: user.onboardingCompleted || false,
        completedTours: user.completedTours || [],
        broadcasterRole: user.broadcasterRole || undefined,
        parentBroadcasterId: user.parentBroadcasterId || undefined,
        groupId: user.groupId || undefined,
        groupPermissions: loginGroupPermissions || undefined
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao fazer login' });
  }
};

// Obter dados do usuário logado
export const getMe = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.userId).select('-password');

    if (!user) {
      res.status(404).json({ error: 'Usuário não encontrado' });
      return;
    }

    // Para sub-usuarios (sales), buscar permissoes do grupo
    let groupPermissions: PagePermission[] | undefined;
    if (user.broadcasterRole === 'sales') {
      groupPermissions = await getSalesPermissions(user.groupId);
    }

    res.json({
      id: user._id,
      email: user.email,
      userType: user.userType,
      status: user.status,
      name: user.name,
      companyName: user.companyName,
      fantasyName: user.fantasyName,
      phone: user.phone,
      cpf: user.cpf,
      cpfOrCnpj: user.cpfOrCnpj,
      cnpj: user.cnpj,
      razaoSocial: user.razaoSocial,
      address: user.address,
      onboardingCompleted: user.onboardingCompleted || false,
      completedTours: user.completedTours || [],
      broadcasterProfile: user.broadcasterProfile,
      broadcasterRole: user.broadcasterRole || undefined,
      parentBroadcasterId: user.parentBroadcasterId || undefined,
      groupId: user.groupId || undefined,
      groupPermissions: groupPermissions || undefined
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar usuário' });
  }
};

// Atualizar perfil do usuário
export const updateProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId;
    const updates = req.body;


    // Campos permitidos para atualização
    const allowedFields = [
      'name',
      'email',
      'phone',
      'cpf',
      'companyName',
      'fantasyName',
      'cpfOrCnpj',
      'razaoSocial',
      'address'
    ];

    // Filtrar apenas campos permitidos
    const filteredUpdates: any = {};
    Object.keys(updates).forEach(key => {
      if (allowedFields.includes(key)) {
        filteredUpdates[key] = updates[key];
      }
    });

    // Troca de email exige reautenticacao com senha atual
    if (filteredUpdates.email) {
      const currentUser = await User.findById(userId).select('email password');
      if (currentUser && filteredUpdates.email !== currentUser.email) {
        const { currentPassword } = updates;
        if (!currentPassword) {
          res.status(400).json({ error: 'Senha atual é obrigatória para alterar o email' });
          return;
        }
        const isPasswordValid = await bcrypt.compare(currentPassword, currentUser.password);
        if (!isPasswordValid) {
          res.status(401).json({ error: 'Senha atual incorreta' });
          return;
        }

        // Verificar se email já está em uso por outro usuário
        const existingUser = await User.findOne({
          email: filteredUpdates.email,
          _id: { $ne: userId }
        });
        if (existingUser) {
          res.status(400).json({ error: 'Email já está em uso' });
          return;
        }

        filteredUpdates.emailConfirmed = false;
      }
    }

    const user = await User.findByIdAndUpdate(
      userId,
      filteredUpdates,
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      res.status(404).json({ error: 'Usuário não encontrado' });
      return;
    }

    // Invalida cache de auth (dados do usuario mudaram)
    await invalidateUserCache(userId as string);

    res.json({ message: 'Perfil atualizado com sucesso', user });
  } catch (error: any) {
    res.status(500).json({ error: 'Erro ao atualizar perfil' });
  }
};

// Alterar senha do usuário
export const changePassword = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: 'Senha atual e nova senha são obrigatórias' });
      return;
    }

    const passwordError = validatePasswordStrength(newPassword);
    if (passwordError) {
      res.status(400).json({ error: passwordError });
      return;
    }


    // Buscar usuário com senha
    const user = await User.findById(userId);

    if (!user) {
      res.status(404).json({ error: 'Usuário não encontrado' });
      return;
    }

    // Verificar senha atual
    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);

    if (!isPasswordValid) {
      res.status(401).json({ error: 'Senha atual incorreta' });
      return;
    }

    // Hash da nova senha
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Atualizar senha
    user.password = hashedPassword;
    await user.save();

    // Invalida cache de auth
    await invalidateUserCache(user._id.toString());

    // Revoga todas as sessoes ativas — impede uso de tokens roubados apos troca de senha
    await revokeAllUserTokens(user._id.toString());

    res.json({ message: 'Senha alterada com sucesso' });
  } catch (error: any) {
    res.status(500).json({ error: 'Erro ao alterar senha' });
  }
};

/**
 * Habilitar autenticação em duas etapas
 */
export const enableTwoFactor = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId;


    const user = await User.findById(userId);
    if (!user) {
      res.status(404).json({ error: 'Usuário não encontrado' });
      return;
    }

    // Gera token de confirmação único
    const confirmToken = crypto.randomBytes(32).toString('hex');
    const tokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h


    user.twoFactorPendingToken = confirmToken;
    user.twoFactorPendingTokenExpires = tokenExpires;
    user.twoFactorEnabled = false; // Será true após confirmação
    await user.save();


    // Verifica se foi realmente salvo
    const savedUser = await User.findById(user._id).select('email twoFactorPendingToken twoFactorPendingTokenExpires');

    // Envia email de confirmação
    await sendTwoFactorEnableEmail(user.email, user.name || user.companyName || 'Usuário', confirmToken);

    res.json({ message: 'Email de confirmação enviado. Verifique sua caixa de entrada.' });
  } catch (error: any) {
    res.status(500).json({ error: 'Erro ao habilitar autenticação em duas etapas' });
  }
};

/**
 * Confirmar habilitação de 2FA via link do email
 */
export const confirmTwoFactorEnable = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.params;


    // Busca usuario pelo token pendente de confirmacao
    let user = await User.findOne({
      twoFactorPendingToken: token,
      twoFactorPendingTokenExpires: { $gt: new Date() }
    });

    // Fallback: busca em twoFactorSecret (tokens antigos antes da correcao)
    if (!user) {
      user = await User.findOne({
        twoFactorSecret: token,
        twoFactorPendingTokenExpires: { $gt: new Date() }
      });
    }





    if (!user) {
      res.status(400).json({ error: 'Token inválido ou expirado' });
      return;
    }


    user.twoFactorEnabled = true;
    user.twoFactorConfirmedAt = new Date();
    user.twoFactorPendingToken = undefined;
    user.twoFactorPendingTokenExpires = undefined;
    await user.save();

    res.json({ message: 'Autenticação em duas etapas habilitada com sucesso!' });
  } catch (error: any) {
    res.status(500).json({ error: 'Erro ao confirmar autenticação em duas etapas' });
  }
};

/**
 * Desabilitar autenticação em duas etapas
 */
export const disableTwoFactor = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId;
    const { password } = req.body;


    const user = await User.findById(userId);
    if (!user) {
      res.status(404).json({ error: 'Usuário não encontrado' });
      return;
    }

    // Valida senha atual
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      res.status(401).json({ error: 'Senha incorreta' });
      return;
    }

    user.twoFactorEnabled = false;
    user.twoFactorPendingToken = undefined;
    user.twoFactorConfirmedAt = undefined;
    user.twoFactorPendingTokenExpires = undefined;
    await user.save();

    res.json({ message: 'Autenticação em duas etapas desabilitada' });
  } catch (error: any) {
    res.status(500).json({ error: 'Erro ao desabilitar autenticação em duas etapas' });
  }
};

/**
 * Validar código 2FA no login
 */
export const validateTwoFactorLogin = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, token } = req.body;


    const user = await User.findOne({
      _id: userId,
      twoFactorPendingToken: token,
      twoFactorPendingTokenExpires: { $gt: new Date() }
    });

    if (!user) {
      res.status(400).json({ error: 'Código inválido ou expirado' });
      return;
    }

    // Limpa token temporário
    user.twoFactorPendingToken = undefined;
    user.twoFactorPendingTokenExpires = undefined;
    await user.save();

    // Device fingerprint + tokens (access 15min + refresh 7d em cookies httpOnly)
    ensureDeviceFingerprintCookie(req, res);
    const accessToken = generateAccessToken(user._id.toString());
    const { rawToken: refreshTokenRaw } = await generateRefreshToken(user._id.toString(), req);
    setAuthCookies(res, accessToken, refreshTokenRaw);

    let twoFaLoginPerms: PagePermission[] | undefined;
    if (user.broadcasterRole === 'sales') {
      twoFaLoginPerms = await getSalesPermissions(user.groupId);
    }

    res.json({
      message: 'Login realizado com sucesso!',
      user: {
        id: user._id,
        email: user.email,
        userType: user.userType,
        status: user.status,
        companyName: user.companyName,
        fantasyName: user.fantasyName,
        phone: user.phone,
        cpfOrCnpj: user.cpfOrCnpj,
        cnpj: user.cnpj,
        address: user.address,
        onboardingCompleted: user.onboardingCompleted || false,
        broadcasterRole: user.broadcasterRole || undefined,
        parentBroadcasterId: user.parentBroadcasterId || undefined,
        groupId: user.groupId || undefined,
        groupPermissions: twoFaLoginPerms || undefined
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Erro ao validar código de verificação' });
  }
};

/**
 * Verifica código de 6 dígitos e finaliza login
 */
export const verifyTwoFactorCode = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId: sessionToken, code, trustDevice } = req.body;

    // Busca por session token opaco (nao por ObjectId)
    const user = await User.findOne({
      twoFactorSessionToken: sessionToken,
      twoFactorCodeExpires: { $gt: new Date() }
    });

    if (!user) {
      res.status(400).json({ error: 'Código inválido ou expirado' });
      return;
    }

    // Compara hash do codigo informado com hash armazenado no banco
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    if (user.twoFactorCode !== codeHash) {
      user.twoFactorAttempts = (user.twoFactorAttempts || 0) + 1;
      if (user.twoFactorAttempts >= 5) {
        user.twoFactorCode = undefined;
        user.twoFactorCodeExpires = undefined;
        user.twoFactorSessionToken = undefined;
        user.twoFactorAttempts = 0;
        await user.save();
        res.status(400).json({ error: 'Muitas tentativas. Solicite um novo código fazendo login novamente.' });
        return;
      }
      await user.save();
      res.status(400).json({ error: 'Código inválido ou expirado' });
      return;
    }


    // Se usuário marcou "Confiar neste dispositivo"
    if (trustDevice) {
      const userAgent = req.headers['user-agent'] || 'unknown';
      const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
      const deviceId = crypto.createHash('sha256').update(`${userAgent}${ipAddress}`).digest('hex');

      // Extrai nome do dispositivo do user-agent
      let deviceName = 'Navegador Desconhecido';
      if (userAgent.includes('Chrome')) deviceName = 'Chrome';
      else if (userAgent.includes('Firefox')) deviceName = 'Firefox';
      else if (userAgent.includes('Safari')) deviceName = 'Safari';
      else if (userAgent.includes('Edge')) deviceName = 'Edge';

      // Adiciona dispositivo aos confiáveis
      if (!user.trustedDevices) {
        user.trustedDevices = [];
      }

      // Cap trusted devices at 10
      if (user.trustedDevices.length >= 10) {
        user.trustedDevices.shift(); // Remove oldest
      }

      user.trustedDevices.push({
        deviceId,
        deviceName,
        lastUsed: new Date(),
        createdAt: new Date()
      });

    }

    // Limpa código usado e session token
    user.twoFactorCode = undefined;
    user.twoFactorCodeExpires = undefined;
    user.twoFactorSessionToken = undefined;
    user.twoFactorAttempts = 0;
    await user.save();

    // Device fingerprint + tokens (access 15min + refresh 7d em cookies httpOnly)
    ensureDeviceFingerprintCookie(req, res);
    const accessToken = generateAccessToken(user._id.toString());
    const { rawToken: refreshTokenRaw } = await generateRefreshToken(user._id.toString(), req);
    setAuthCookies(res, accessToken, refreshTokenRaw);

    let verifyTwoFaPerms: PagePermission[] | undefined;
    if (user.broadcasterRole === 'sales') {
      verifyTwoFaPerms = await getSalesPermissions(user.groupId);
    }

    res.json({
      message: 'Login realizado com sucesso!',
      user: {
        id: user._id,
        email: user.email,
        userType: user.userType,
        status: user.status,
        companyName: user.companyName,
        fantasyName: user.fantasyName,
        phone: user.phone,
        cpfOrCnpj: user.cpfOrCnpj,
        cnpj: user.cnpj,
        address: user.address,
        onboardingCompleted: user.onboardingCompleted || false,
        completedTours: user.completedTours || [],
        broadcasterRole: user.broadcasterRole || undefined,
        parentBroadcasterId: user.parentBroadcasterId || undefined,
        groupId: user.groupId || undefined,
        groupPermissions: verifyTwoFaPerms || undefined
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Erro ao verificar código' });
  }
};

/**
 * Obter status do 2FA
 */
export const getTwoFactorStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId;

    const user = await User.findById(userId).select('twoFactorEnabled twoFactorConfirmedAt');
    if (!user) {
      res.status(404).json({ error: 'Usuário não encontrado' });
      return;
    }

    res.json({
      enabled: user.twoFactorEnabled || false,
      confirmedAt: user.twoFactorConfirmedAt
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Erro ao obter status' });
  }
};

/**
 * Rotacionar refresh token — gera novo par access+refresh
 * POST /api/auth/refresh
 */
export const refreshTokenHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const rawToken = req.cookies?.refresh_token;
    if (!rawToken) {
      res.status(401).json({ error: 'Refresh token não fornecido' });
      return;
    }

    const result = await rotateRefreshToken(rawToken, req);
    if (!result) {
      clearAuthCookies(res);
      res.status(401).json({ error: 'Refresh token inválido ou expirado' });
      return;
    }

    setAuthCookies(res, result.accessToken, result.newRawRefresh);

    res.json({
      message: 'Token renovado com sucesso'
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao renovar token' });
  }
};

/**
 * Solicitar redefinição de senha — envia email com link
 * POST /api/auth/forgot-password
 */
export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;

    if (!email) {
      res.status(400).json({ error: 'Email é obrigatório' });
      return;
    }

    // Resposta genérica para prevenir enumeração de contas
    const genericResponse = {
      message: 'Se este email estiver cadastrado, você receberá um link para redefinir sua senha.'
    };

    const user = await User.findOne({ email: email.toLowerCase().trim() });

    if (!user) {
      // Retorna mesma resposta genérica — não revela se email existe
      res.json(genericResponse);
      return;
    }

    // Cooldown: impede envio de multiplos emails de reset em menos de 60s
    if (user.passwordResetTokenExpires) {
      const tokenCreatedAt = new Date(user.passwordResetTokenExpires.getTime() - 60 * 60 * 1000); // expiry - 1h = created
      const secondsSinceLastEmail = (Date.now() - tokenCreatedAt.getTime()) / 1000;
      if (secondsSinceLastEmail < 60) {
        res.json(genericResponse);
        return;
      }
    }

    // Gera token de reset
    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

    user.passwordResetToken = resetToken;
    user.passwordResetTokenExpires = tokenExpires;
    await user.save();

    // Envia email
    await sendPasswordResetEmail(
      user.email,
      user.companyName || user.fantasyName || user.name || 'Usuário',
      resetToken
    );

    res.json(genericResponse);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao processar solicitação' });
  }
};

/**
 * Redefinir senha via token do email
 * POST /api/auth/reset-password/:token
 */
export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    if (!password) {
      res.status(400).json({ error: 'Nova senha é obrigatória' });
      return;
    }

    // Validar força da senha
    const passwordError = validatePasswordStrength(password);
    if (passwordError) {
      res.status(400).json({ error: passwordError });
      return;
    }

    // Hash da nova senha
    const hashedPassword = await bcrypt.hash(password, 12);

    // Operacao atomica para prevenir race conditions (#33)
    const user = await User.findOneAndUpdate(
      {
        passwordResetToken: token,
        passwordResetTokenExpires: { $gt: new Date() }
      },
      {
        $set: { password: hashedPassword },
        $unset: { passwordResetToken: '', passwordResetTokenExpires: '' }
      },
      { new: true }
    );

    if (!user) {
      res.status(400).json({ error: 'Link inválido ou expirado. Solicite uma nova redefinição de senha.' });
      return;
    }

    // Revoga todos os refresh tokens existentes por segurança
    await revokeAllUserTokens(user._id.toString());

    res.json({ message: 'Senha redefinida com sucesso! Faça login com sua nova senha.' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao redefinir senha' });
  }
};

/**
 * Logout — revoga refresh token e limpa cookies
 * POST /api/auth/logout
 */
export const logoutHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Revoga todos os refresh tokens do usuario se autenticado
    if (req.userId) {
      await revokeAllUserTokens(req.userId);
    }

    clearAuthCookies(res);
    res.json({ message: 'Logout realizado com sucesso' });
  } catch (error) {
    // Limpa cookies mesmo em caso de erro no banco
    clearAuthCookies(res);
    res.json({ message: 'Logout realizado' });
  }
};

export const updateCompletedTours = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { tourId } = req.body;

    if (!tourId || typeof tourId !== 'string') {
      res.status(400).json({ error: 'tourId é obrigatório' });
      return;
    }

    const user = await User.findByIdAndUpdate(
      req.userId,
      { $addToSet: { completedTours: tourId } },
      { new: true, select: 'completedTours' }
    );

    if (!user) {
      res.status(404).json({ error: 'Usuário não encontrado' });
      return;
    }

    res.json({ completedTours: user.completedTours });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar tours concluídos' });
  }
};
