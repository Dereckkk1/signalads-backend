import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { User } from '../models/User';
import { sendTwoFactorEnableEmail, sendTwoFactorLoginEmail, sendTwoFactorCodeEmail } from '../services/emailService';
import { AuthRequest } from '../middleware/auth';

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, userType, cpfOrCnpj, companyName, fantasyName, phone, cnpj, address } = req.body;

    // ⚠️ BROADCASTER NÃO PODE SE AUTO-CADASTRAR - Apenas admin cria via catalog
    if (userType === 'broadcaster') {
      res.status(403).json({
        error: 'Emissoras não podem se auto-cadastrar. Entre em contato com o administrador.'
      });
      return;
    }

    // Verificar se usuário já existe
    const existingUser = await User.findOne({ $or: [{ email }, { cpfOrCnpj }] });
    if (existingUser) {
      res.status(400).json({ error: 'Email ou CPF/CNPJ já cadastrado' });
      return;
    }

    // Hash da senha
    const hashedPassword = await bcrypt.hash(password, 10);

    // Criar usuário (apenas advertiser ou agency)
    const user = new User({
      email,
      password: hashedPassword,
      userType,
      status: 'approved', // Advertiser e Agency aprovados automaticamente
      cpfOrCnpj,
      companyName,
      fantasyName,
      phone,
      cnpj,
      address
    });

    await user.save();

    res.status(201).json({
      message: 'Usuário cadastrado com sucesso!',
      user: {
        id: user._id,
        email: user.email,
        userType: user.userType,
        status: user.status
      }
    });
  } catch (error) {
    console.error('Erro no registro:', error);
    res.status(500).json({ error: 'Erro ao cadastrar usuário' });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { emailOrCnpj, password } = req.body;

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

    // Verificar status apenas para rejeição (pending pode logar mas vai ver tela de aprovaçãotart
    if (user.userType === 'broadcaster' && user.status === 'rejected') {
      res.status(403).json({
        error: 'account_rejected',
        message: user.rejectionReason || 'Sua conta foi reprovada. Entre em contato com o suporte para mais informações.'
      });
      return;
    }

    // Gerar token JWT (permite pending logar, frontend controla a navegação)
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new Error('JWT_SECRET não está definido');
    }

    const token = jwt.sign({ userId: user._id }, jwtSecret, { expiresIn: '7d' });

    // Verificar se 2FA está habilitado
    if (user.twoFactorEnabled && user.twoFactorConfirmedAt) {

      // Cria ID único do dispositivo baseado em user-agent e IP
      const userAgent = req.headers['user-agent'] || 'unknown';
      const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
      const deviceId = crypto.createHash('sha256').update(`${userAgent}${ipAddress}`).digest('hex');


      // Verifica se dispositivo é confiável
      const isTrustedDevice = user.trustedDevices?.some(d => d.deviceId === deviceId);

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

        // Gera código de 6 dígitos
        const twoFactorCode = Math.floor(100000 + Math.random() * 900000).toString();
        const codeExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutos

        user.twoFactorCode = twoFactorCode;
        user.twoFactorCodeExpires = codeExpires;
        await user.save();

        // Envia email com código
        await sendTwoFactorCodeEmail(user.email, user.name || user.companyName || 'Usuário', twoFactorCode);

        res.json({
          requiresTwoFactor: true,
          message: 'Código de verificação enviado para seu email',
          userId: user._id
        });
        return;
      }
    }

    res.json({
      message: 'Login realizado com sucesso!',
      token,
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
        onboardingCompleted: user.onboardingCompleted || false
      }
    });
  } catch (error) {
    console.error('❌ Erro no login:', error);
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
      broadcasterProfile: user.broadcasterProfile
    });
  } catch (error) {
    console.error('❌ Erro ao buscar usuário:', error);
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

    // Verificar se email já está em uso por outro usuário
    if (filteredUpdates.email) {
      const existingUser = await User.findOne({
        email: filteredUpdates.email,
        _id: { $ne: userId }
      });

      if (existingUser) {
        res.status(400).json({ message: 'Email já está em uso' });
        return;
      }
    }

    const user = await User.findByIdAndUpdate(
      userId,
      filteredUpdates,
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      res.status(404).json({ message: 'Usuário não encontrado' });
      return;
    }

    res.json({ message: 'Perfil atualizado com sucesso', user });
  } catch (error: any) {
    console.error('❌ Erro ao atualizar perfil:', error);
    res.status(500).json({ message: 'Erro ao atualizar perfil', error: error.message });
  }
};

// Alterar senha do usuário
export const changePassword = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      res.status(400).json({ message: 'Senha atual e nova senha são obrigatórias' });
      return;
    }

    if (newPassword.length < 8) {
      res.status(400).json({ message: 'A nova senha deve ter no mínimo 8 caracteres' });
      return;
    }


    // Buscar usuário com senha
    const user = await User.findById(userId);

    if (!user) {
      res.status(404).json({ message: 'Usuário não encontrado' });
      return;
    }

    // Verificar senha atual
    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);

    if (!isPasswordValid) {
      res.status(401).json({ message: 'Senha atual incorreta' });
      return;
    }

    // Hash da nova senha
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Atualizar senha
    user.password = hashedPassword;
    await user.save();

    res.json({ message: 'Senha alterada com sucesso' });
  } catch (error: any) {
    console.error('❌ Erro ao alterar senha:', error);
    res.status(500).json({ message: 'Erro ao alterar senha', error: error.message });
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
      res.status(404).json({ message: 'Usuário não encontrado' });
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
    console.error('❌ Erro ao habilitar 2FA:', error);
    res.status(500).json({ message: 'Erro ao habilitar autenticação em duas etapas' });
  }
};

/**
 * Confirmar habilitação de 2FA via link do email
 */
export const confirmTwoFactorEnable = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.params;


    // Tenta buscar primeiro em twoFactorPendingToken (novo)
    let user = await User.findOne({
      twoFactorPendingToken: token,
      twoFactorPendingTokenExpires: { $gt: new Date() }
    });


    // Fallback: busca em twoFactorSecret (tokens antigos antes da correção)
    user = await User.findOne({
      twoFactorSecret: token,
      twoFactorPendingTokenExpires: { $gt: new Date() }
    });




    // Debug: Buscar qualquer usuário com token pendente para comparação





    if (!user) {
      res.status(400).json({ message: 'Token inválido ou expirado' });
      return;
    }


    user.twoFactorEnabled = true;
    user.twoFactorConfirmedAt = new Date();
    user.twoFactorPendingToken = crypto.randomBytes(32).toString('hex'); // Novo secret permanente
    user.twoFactorPendingToken = undefined;
    user.twoFactorPendingTokenExpires = undefined;
    await user.save();

    res.json({ message: 'Autenticação em duas etapas habilitada com sucesso!' });
  } catch (error: any) {
    console.error('❌ Erro ao confirmar 2FA:', error);
    res.status(500).json({ message: 'Erro ao confirmar autenticação em duas etapas' });
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
      res.status(404).json({ message: 'Usuário não encontrado' });
      return;
    }

    // Valida senha atual
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      res.status(401).json({ message: 'Senha incorreta' });
      return;
    }

    user.twoFactorEnabled = false;
    user.twoFactorPendingToken = undefined;
    user.twoFactorConfirmedAt = undefined;
    user.twoFactorPendingToken = undefined;
    user.twoFactorPendingTokenExpires = undefined;
    await user.save();

    res.json({ message: 'Autenticação em duas etapas desabilitada' });
  } catch (error: any) {
    console.error('❌ Erro ao desabilitar 2FA:', error);
    res.status(500).json({ message: 'Erro ao desabilitar autenticação em duas etapas' });
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
      res.status(400).json({ message: 'Código inválido ou expirado' });
      return;
    }

    // Limpa token temporário
    user.twoFactorPendingToken = undefined;
    user.twoFactorPendingTokenExpires = undefined;
    await user.save();

    // Gera JWT de autenticação
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new Error('JWT_SECRET não está definido');
    }

    const jwtToken = jwt.sign({ userId: user._id }, jwtSecret, { expiresIn: '7d' });

    res.json({
      message: 'Login realizado com sucesso!',
      token: jwtToken,
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
        onboardingCompleted: user.onboardingCompleted || false
      }
    });
  } catch (error: any) {
    console.error('❌ Erro ao validar 2FA:', error);
    res.status(500).json({ message: 'Erro ao validar código de verificação' });
  }
};

/**
 * Verifica código de 6 dígitos e finaliza login
 */
export const verifyTwoFactorCode = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, code, trustDevice } = req.body;


    const user = await User.findOne({
      _id: userId,
      twoFactorCode: code,
      twoFactorCodeExpires: { $gt: new Date() }
    });

    if (!user) {
      res.status(400).json({ message: 'Código inválido ou expirado' });
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

      user.trustedDevices.push({
        deviceId,
        deviceName,
        lastUsed: new Date(),
        createdAt: new Date()
      });

    }

    // Limpa código usado
    user.twoFactorCode = undefined;
    user.twoFactorCodeExpires = undefined;
    await user.save();

    // Gera token JWT
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new Error('JWT_SECRET não está definido');
    }

    const token = jwt.sign({ userId: user._id }, jwtSecret, { expiresIn: '7d' });


    res.json({
      message: 'Login realizado com sucesso!',
      token,
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
        onboardingCompleted: user.onboardingCompleted || false
      }
    });
  } catch (error: any) {
    console.error('❌ Erro ao verificar código 2FA:', error);
    res.status(500).json({ message: 'Erro ao verificar código' });
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
      res.status(404).json({ message: 'Usuário não encontrado' });
      return;
    }

    res.json({
      enabled: user.twoFactorEnabled || false,
      confirmedAt: user.twoFactorConfirmedAt
    });
  } catch (error: any) {
    console.error('❌ Erro ao obter status 2FA:', error);
    res.status(500).json({ message: 'Erro ao obter status' });
  }
};
