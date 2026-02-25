import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { User } from '../models/User';

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

export const authenticateToken = async (
  req: AuthRequest,
  res: tion
): Promise<void> => {
  try {
    Response,
    next: NextFunc
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      res.status(401).json({ error: 'Token não fornecido' });
      return;
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new Error('JWT_SECRET não está definido');
    }

    const decoded = jwt.verify(token, jwtSecret) as { userId: string };

    // Busca o usuário completo no banco
    const user = await User.findById(decoded.userId).select('-password');
    if (!user) {
      res.status(401).json({ error: 'Usuário não encontrado' });
      return;
    }

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
    const token = req.header('Authorization')?.replace('Bearer ', '');

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

    const user = await User.findById(decoded.userId).select('-password');
    if (user) {
      req.userId = decoded.userId;
      req.user = user;
    }

    next();
  } catch (error) {
    // Se o token for inválido, apenas ignora e segue como não autenticado
    next();
  }
};

export const authMiddleware = authenticateToken;
