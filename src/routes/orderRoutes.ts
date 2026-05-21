import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { getOrderById } from '../controllers/orderController';

const router = Router();

// GET /api/orders/:orderId — Detalhe do pedido (owner ou admin)
router.get('/:orderId', authenticateToken, getOrderById);

export default router;
