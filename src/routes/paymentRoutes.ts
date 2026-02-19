import express from 'express';
import {
  processCheckout,
  handleWebhook,
  getOrderStatus,
  getUserOrders
} from '../controllers/paymentController';
import { authenticateToken } from '../middleware/auth';

const router = express.Router();

/**
 * Rotas de Pagamento
 */

// POST /api/payment/checkout - Processar checkout
router.post('/checkout', authenticateToken, processCheckout);

// POST /api/payment/webhook - Webhook Asaas (sem autenticação)
router.post('/webhook', handleWebhook);

// GET /api/payment/:orderId - Consultar status de pedido
router.get('/:orderId', authenticateToken, getOrderStatus);

// GET /api/payment/orders - Listar pedidos do usuário
router.get('/orders/list', authenticateToken, getUserOrders);

export default router;
