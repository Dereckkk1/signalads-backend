import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { User } from '../models/User';
import { cacheGet, cacheSet, redis } from '../config/redis';

// TTL do cache de auth = 900s (15min, mesmo do JWT)
const AUTH_CACHE_TTL = 900;

export interface AuthRequest extends Request {
  userId?: string;
  user?: {
    _id: any;
    email: string;
    userType: string;
    [key: string]: any;
  };
  file?: Express.Multer.File | undefined;
}

/**
 * Invalida cache de auth de um usuario.
 * DEVE ser chamado sempre que dados do usuario forem alterados
 * (perfil, senha, role, status, 2FA, approve/reject).
 */
export async function invalidateUserCache(userId: string): Promise<void> {
  try {
    await redis.del(`auth:user:${userId}`);
  } catch {
    // Cache miss nao deve quebrar a app
  }
}

export const authenticateToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Dual-mode: cookie httpOnly primeiro, header Authorization como fallback
    const tokenFromCookie = req.cookies?.access_token;
    const tokenFromHeader = req.header('Authorization')?.replace('Bearer ', '');
    const token = tokenFromCookie || tokenFromHeader;

    if (!token) {
      res.status(401).json({ error: 'Token não fornecido' });
      return;
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new Error('JWT_SECRET não está definido');
    }

    const decoded = jwt.verify(token, jwtSecret) as { userId: string };

    // Tenta cache Redis antes de ir ao MongoDB
    const cacheKey = `auth:user:${decoded.userId}`;
    const cachedUser = await cacheGet<any>(cacheKey);
    if (cachedUser) {
      if (cachedUser.status !== 'approved') {
        res.status(403).json({ error: 'Conta suspensa ou pendente de aprovação' });
        return;
      }
      req.userId = decoded.userId;
      req.user = cachedUser;
      next();
      return;
    }

    // Cache miss — busca no banco
    const user = await User.findById(decoded.userId).select('-password');
    if (!user) {
      res.status(401).json({ error: 'Usuário não encontrado' });
      return;
    }

    if (user.status !== 'approved') {
      res.status(403).json({ error: 'Conta suspensa ou pendente de aprovação' });
      return;
    }

    // Salva no cache (objeto plain, sem metodos Mongoose)
    await cacheSet(cacheKey, user.toObject(), AUTH_CACHE_TTL);

    req.userId = decoded.userId;
    req.user = user;

    next();
  } catch (error) {
    res.status(401).json({ error: 'Token inválido' });
  }
};

export const optionalAuthenticateToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Dual-mode: cookie httpOnly primeiro, header Authorization como fallback
    const tokenFromCookie = req.cookies?.access_token;
    const tokenFromHeader = req.header('Authorization')?.replace('Bearer ', '');
    const token = tokenFromCookie || tokenFromHeader;

    if (!token) {
      next();
      return;
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      next(); // Fail safe
      return;
    }

    const decoded = jwt.verify(token, jwtSecret) as { userId: string };

    // Tenta cache Redis
    const cacheKey = `auth:user:${decoded.userId}`;
    const cachedUser = await cacheGet<any>(cacheKey);
    if (cachedUser) {
      req.userId = decoded.userId;
      req.user = cachedUser;
      next();
      return;
    }

    const user = await User.findById(decoded.userId).select('-password');
    if (user) {
      await cacheSet(cacheKey, user.toObject(), AUTH_CACHE_TTL);
      req.userId = decoded.userId;
      req.user = user;
    }

    next();
  } catch (error) {
    // Se o token for inválido, apenas ignora e segue como não autenticado
    next();
  }
};

export const requireAdmin = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void => {
  if (req.user?.userType !== 'admin') {
    res.status(403).json({ error: 'Acesso restrito a administradores' });
    return;
  }
  next();
};

export const authMiddleware = authenticateToken;
