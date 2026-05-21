import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import Order from '../models/Order';

/**
 * GET /api/orders/:orderId
 *
 * Retorna um pedido específico pelo ID. Acesso permitido apenas
 * para o dono do pedido (buyerId) ou administradores. Usado pela
 * tela de detalhe do pedido (página `/orders/:orderId`).
 */
export const getOrderById = async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: 'Não autenticado' });
    return;
  }

  try {
    const order = await Order.findById(req.params.orderId);
    if (!order) {
      res.status(404).json({ error: 'Pedido não encontrado' });
      return;
    }

    const isOwner = String((order as any).buyerId) === String(userId);
    const isAdmin = req.user?.userType === 'admin';
    if (!isOwner && !isAdmin) {
      res.status(403).json({ error: 'Acesso negado' });
      return;
    }

    res.status(200).json(order);
  } catch (err) {
    console.error('[getOrderById] error', err);
    res.status(500).json({ error: 'Erro ao buscar pedido' });
  }
};
