import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { checkout } from '../controllers/checkoutController';

const router = Router();

// POST /api/payment/checkout — Cria pedido a partir do carrinho
router.post('/checkout', authenticateToken, checkout);

export default router;
