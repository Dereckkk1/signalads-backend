import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { checkout } from '../controllers/checkoutController';
import { asaasWebhook } from '../controllers/webhookController';
import { getPixForOrder, getPaymentStatusForOrder } from '../controllers/paymentController';
import { createRedisStore } from '../config/rateLimitStore';
import { getClientIp } from '../utils/clientIp';

const router = Router();

// Em ambiente de teste o rate limit fica inativo para nao quebrar suites
// (varios testes disparam >10 requests no mesmo IP/userId em sequencia).
const isTest = process.env.NODE_ENV === 'test';

// POST /api/payment/checkout — 10 tentativas/min por usuario (ou IP se anonimo).
// Protege contra brute force de cartao e enxames de checkout do mesmo comprador.
const checkoutLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisStore('checkout'),
  keyGenerator: (req) => {
    const userId = (req as AuthRequest).userId;
    return userId ? `user:${userId}` : `ip:${ipKeyGenerator(getClientIp(req))}`;
  },
  skip: () => isTest,
  message: { error: 'Muitas tentativas de pagamento. Aguarde um minuto.' },
});

// POST /api/payment/asaas-webhook — 100 req/min por IP.
// Asaas envia poucas notificacoes por segundo; 100/min absorve picos
// sem deixar atacante enviar 10k webhooks falsos para esgotar workers.
const webhookLimiter = rateLimit({
  windowMs: 60_000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisStore('asaasWebhook'),
  keyGenerator: (req) => ipKeyGenerator(getClientIp(req)),
  skip: () => isTest,
  message: { error: 'Rate limit excedido' },
});

// POST /api/payment/checkout — Cria pedido a partir do carrinho.
// ORDEM IMPORTA: authenticateToken precisa rodar ANTES do checkoutLimiter,
// senao req.userId ainda e undefined quando o keyGenerator roda e o limite
// cai sempre no ramo por IP — usuarios atras do mesmo NAT dividiriam a cota
// e um comprador com IP rotativo escaparia do limite por conta.
router.post('/checkout', authenticateToken, checkoutLimiter, checkout);

// POST /api/payment/asaas-webhook — Recebe notificações do gateway Asaas.
// SEM authenticateToken — autenticação é via header `asaas-access-token`
// validado dentro do handler contra process.env.WEBHOOK_AUTH_TOKEN.
router.post('/asaas-webhook', webhookLimiter, asaasWebhook);

// GET /api/payment/pix/:orderId — QR Code + copia-cola PIX do pedido
router.get('/pix/:orderId', authenticateToken, getPixForOrder);

// GET /api/payment/status/:orderId — Polling de status do pagamento
router.get('/status/:orderId', authenticateToken, getPaymentStatusForOrder);

export default router;
