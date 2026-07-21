/**
 * Integration Tests — Integridade financeira (Fase 2)
 *
 * Regressao de `docs/security-remediation-plan-2026-07-20.md`:
 *  - 2.1 webhook reconcilia valor e status contra GET /payments/:id
 *  - 2.3 idempotencia por eventId; erro transitorio devolve 500 (permite retry)
 *  - 2.4 schedule precisa bater com a quantidade contratada
 *
 * Os testes afirmam que o ATAQUE falha, nao apenas que o codigo mudou.
 */

jest.mock('../../services/asaasService', () => ({
  CONFIRMED_ASAAS_STATUSES: ['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH'],
  getPaymentStatus: jest.fn(),
}));

import '../helpers/mocks';
import * as asaasService from '../../services/asaasService';

import request from 'supertest';
import express, { Application } from 'express';
import cookieParser from 'cookie-parser';

import { mongoSanitize, xssSanitize, dedupeQuery } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';
import paymentRoutes from '../../routes/paymentRoutes';
import cartRoutes from '../../routes/cartRoutes';

import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { createAdvertiser, createBroadcaster } from '../helpers/authHelper';
import Order from '../../models/Order';
import { Cart } from '../../models/Cart';
import { Product } from '../../models/Product';
import { validateScheduleAgainstQuantity } from '../../controllers/cartController';

const WEBHOOK_TOKEN = 'webhook-test-token-fase2';
const ORDER_TOTAL = 525;

function createTestApp(): Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(mongoSanitize);
  app.use(xssSanitize);
  app.use(dedupeQuery);
  app.use(csrfProtection);
  app.use('/api/payment', paymentRoutes);
  app.use('/api/cart', cartRoutes);
  app.use((_req, res) => { res.status(404).json({ error: 'Rota não encontrada' }); });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.status || 500).json({ error: 'Erro interno do servidor' });
  });
  return app;
}

let app: Application;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret-key-for-testing-12345';
  process.env.NODE_ENV = 'test';
  process.env.WEBHOOK_AUTH_TOKEN = WEBHOOK_TOKEN;
  await connectTestDB();
  app = createTestApp();
});

beforeEach(() => {
  (asaasService.getPaymentStatus as jest.Mock).mockResolvedValue({
    status: 'CONFIRMED',
    value: ORDER_TOTAL,
  });
});

afterEach(async () => {
  await clearTestDB();
  jest.clearAllMocks();
});

afterAll(async () => {
  await disconnectTestDB();
});

async function createPendingOrder(asaasPaymentId: string) {
  const { user: buyer } = await createAdvertiser();
  const { user: broadcaster } = await createBroadcaster();

  return Order.create({
    buyerId: buyer._id,
    buyerName: 'Comprador',
    buyerEmail: 'comprador@teste.com.br',
    buyerPhone: '11999999999',
    buyerDocument: '00000000000',
    items: [{
      productId: '507f1f77bcf86cd799439011',
      productName: 'Comercial 30s',
      broadcasterName: 'Rádio Teste',
      broadcasterId: broadcaster._id.toString(),
      quantity: 5,
      unitPrice: 100,
      totalPrice: 500,
      schedule: new Map(),
      material: { type: 'text', text: '', status: 'pending_broadcaster_review', chat: [] },
    }],
    payment: {
      method: 'pix', status: 'pending', asaasPaymentId,
      walletAmountUsed: 0, chargedAmount: ORDER_TOTAL, totalAmount: ORDER_TOTAL,
    },
    splits: [], status: 'pending_payment',
    grossAmount: 500, broadcasterAmount: 375, platformSplit: 125, techFee: 25,
    agencyCommission: 0, monitoringCost: 0, totalAmount: ORDER_TOTAL, subtotal: 500,
    platformFee: 25, billingInvoices: [], billingDocuments: [], broadcasterInvoices: [],
    opecs: [], notifications: [], webhookLogs: [],
  });
}

const postWebhook = (body: any) =>
  request(app)
    .post('/api/payment/asaas-webhook')
    .set('asaas-access-token', WEBHOOK_TOKEN)
    .send(body);

// ─────────────────────────────────────────────────────────────
// 2.1 — Reconciliacao
// ─────────────────────────────────────────────────────────────
describe('2.1 — webhook reconcilia contra a API do Asaas', () => {
  it('SEGURANCA: cobranca de R$ 5 NAO confirma pedido de R$ 525', async () => {
    await createPendingOrder('pay_valor_baixo');
    (asaasService.getPaymentStatus as jest.Mock).mockResolvedValue({
      status: 'CONFIRMED',
      value: 5,
    });

    const res = await postWebhook({
      event: 'PAYMENT_CONFIRMED',
      payment: { id: 'pay_valor_baixo', value: ORDER_TOTAL }, // corpo mente
    });

    expect(res.status).toBe(200);
    expect(res.body.skipped).toBe('valor divergente');

    const order = await Order.findOne({ 'payment.asaasPaymentId': 'pay_valor_baixo' });
    expect(order!.status).toBe('pending_payment');
    expect((order!.payment as any).status).not.toBe('received');
  });

  it('SEGURANCA: corpo do evento nao e fonte de verdade para o status', async () => {
    await createPendingOrder('pay_status_falso');
    (asaasService.getPaymentStatus as jest.Mock).mockResolvedValue({
      status: 'PENDING',
      value: ORDER_TOTAL,
    });

    const res = await postWebhook({
      event: 'PAYMENT_CONFIRMED',
      payment: { id: 'pay_status_falso', status: 'CONFIRMED' }, // corpo mente
    });

    expect(res.status).toBe(200);
    expect(res.body.skipped).toBe('status divergente');

    const order = await Order.findOne({ 'payment.asaasPaymentId': 'pay_status_falso' });
    expect(order!.status).toBe('pending_payment');
  });

  it('confirma quando status E valor batem com a API', async () => {
    await createPendingOrder('pay_ok');

    const res = await postWebhook({ event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_ok' } });

    expect(res.status).toBe(200);
    const order = await Order.findOne({ 'payment.asaasPaymentId': 'pay_ok' });
    expect(order!.status).toBe('paid');
    expect((order!.payment as any).asaasStatus).toBe('CONFIRMED');
  });

  it('tolera diferenca de arredondamento de 1 centavo', async () => {
    await createPendingOrder('pay_centavo');
    (asaasService.getPaymentStatus as jest.Mock).mockResolvedValue({
      status: 'CONFIRMED',
      value: ORDER_TOTAL + 0.009,
    });

    const res = await postWebhook({ event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_centavo' } });

    expect(res.status).toBe(200);
    const order = await Order.findOne({ 'payment.asaasPaymentId': 'pay_centavo' });
    expect(order!.status).toBe('paid');
  });

  it('SEGURANCA: value ausente/NaN nao confirma o pedido', async () => {
    await createPendingOrder('pay_sem_valor');
    (asaasService.getPaymentStatus as jest.Mock).mockResolvedValue({ status: 'CONFIRMED' });

    const res = await postWebhook({ event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_sem_valor' } });

    expect(res.body.skipped).toBe('valor divergente');
    const order = await Order.findOne({ 'payment.asaasPaymentId': 'pay_sem_valor' });
    expect(order!.status).toBe('pending_payment');
  });
});

// ─────────────────────────────────────────────────────────────
// 2.3 — Idempotencia e retry
// ─────────────────────────────────────────────────────────────
describe('2.3 — idempotencia por evento e retry em erro transitorio', () => {
  it('mesmo eventId aplicado duas vezes so tem efeito uma vez', async () => {
    await createPendingOrder('pay_idem');

    const first = await postWebhook({
      id: 'evt_123', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_idem' },
    });
    expect(first.status).toBe(200);

    const second = await postWebhook({
      id: 'evt_123', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_idem' },
    });
    expect(second.status).toBe(200);
    expect(second.body.idempotent).toBe(true);
  });

  it('PAYMENT_REFUNDED reentregue nao reexecuta efeitos', async () => {
    await createPendingOrder('pay_refund');
    await postWebhook({ id: 'evt_a', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_refund' } });
    await postWebhook({ id: 'evt_b', event: 'PAYMENT_REFUNDED', payment: { id: 'pay_refund' } });

    const res = await postWebhook({
      id: 'evt_c', event: 'PAYMENT_REFUNDED', payment: { id: 'pay_refund' },
    });

    expect(res.body.idempotent).toBe(true);
    const order = await Order.findOne({ 'payment.asaasPaymentId': 'pay_refund' });
    expect(order!.status).toBe('refunded');
  });

  it('SEGURANCA: erro transitorio devolve 500 para o Asaas reprocessar', async () => {
    await createPendingOrder('pay_erro');
    (asaasService.getPaymentStatus as jest.Mock).mockRejectedValue(new Error('timeout'));

    const res = await postWebhook({ event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_erro' } });

    // Respondendo 200 aqui, o Asaas consideraria entregue e nunca reenviaria:
    // um pagamento legitimo ficaria eternamente em pending_payment.
    expect(res.status).toBe(500);
    expect(res.body.received).toBe(false);

    const order = await Order.findOne({ 'payment.asaasPaymentId': 'pay_erro' });
    expect(order!.status).toBe('pending_payment');
  });

  it('PAYMENT_REFUSED reverte pedido previamente marcado como pago', async () => {
    await createPendingOrder('pay_recusado');
    await postWebhook({ id: 'evt_1', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_recusado' } });

    const res = await postWebhook({
      id: 'evt_2', event: 'PAYMENT_REFUSED', payment: { id: 'pay_recusado' },
    });

    expect(res.status).toBe(200);
    const order = await Order.findOne({ 'payment.asaasPaymentId': 'pay_recusado' });
    expect(order!.status).toBe('pending_payment');
    expect((order!.payment as any).status).toBe('failed');
  });
});

// ─────────────────────────────────────────────────────────────
// 2.4 — Schedule x quantity
// ─────────────────────────────────────────────────────────────
describe('2.4 — agendamento amarrado a quantidade contratada', () => {
  describe('validateScheduleAgainstQuantity (unidade)', () => {
    it('SEGURANCA: rejeita agendar 1000 tendo comprado 1 (teto por dia)', () => {
      const err = validateScheduleAgainstQuantity({ '2026-08-01': 500, '2026-08-02': 500 }, 1);
      expect(err).toMatch(/Máximo/i);
    });

    it('SEGURANCA: rejeita inflar o total mesmo respeitando o teto por dia', () => {
      // 50+50 = 100 insercoes entregues por 1 comprada, sem estourar o
      // limite diario — e a soma que fecha a brecha, nao o teto.
      const err = validateScheduleAgainstQuantity({ '2026-08-01': 50, '2026-08-02': 50 }, 1);
      expect(err).toMatch(/soma do agendamento/i);
    });

    it('aceita quando a soma bate exatamente', () => {
      expect(validateScheduleAgainstQuantity({ '2026-08-01': 3, '2026-08-02': 2 }, 5)).toBeNull();
    });

    it('rejeita soma menor que a quantidade', () => {
      expect(validateScheduleAgainstQuantity({ '2026-08-01': 2 }, 5)).toMatch(/soma/i);
    });

    it('rejeita formato de data invalido', () => {
      expect(validateScheduleAgainstQuantity({ '01/08/2026': 5 }, 5)).toMatch(/Data/i);
    });

    it('rejeita contagem nao inteira, zero ou negativa', () => {
      expect(validateScheduleAgainstQuantity({ '2026-08-01': 2.5 }, 5)).toMatch(/inválida/i);
      expect(validateScheduleAgainstQuantity({ '2026-08-01': 0 }, 5)).toMatch(/inválida/i);
      expect(validateScheduleAgainstQuantity({ '2026-08-01': -5 }, 5)).toMatch(/inválida/i);
    });

    it('rejeita valor nao numerico (string que somaria por concatenacao)', () => {
      expect(validateScheduleAgainstQuantity({ '2026-08-01': '5' as any }, 5)).toMatch(/inválida/i);
    });

    it('rejeita teto por dia', () => {
      expect(validateScheduleAgainstQuantity({ '2026-08-01': 101 }, 101)).toMatch(/Máximo/i);
    });

    it('aceita schedule vazio ou ausente (item ainda nao agendado)', () => {
      expect(validateScheduleAgainstQuantity({}, 5)).toBeNull();
      expect(validateScheduleAgainstQuantity(null, 5)).toBeNull();
      expect(validateScheduleAgainstQuantity(undefined, 5)).toBeNull();
    });

    it('rejeita array (nao e mapa data->contagem)', () => {
      expect(validateScheduleAgainstQuantity([1, 2, 3] as any, 6)).toMatch(/Formato/i);
    });
  });

  describe('PUT /api/cart/items/schedule (integracao)', () => {
    async function cartWithItem(quantity: number) {
      const { user, auth } = await createAdvertiser();
      const { user: broadcaster } = await createBroadcaster();

      const product = await Product.create({
        broadcasterId: broadcaster._id,
        spotType: 'Comercial 30s',
        duration: 30,
        timeSlot: 'Rotativo',
        netPrice: 100,
        pricePerInsertion: 125,
        isActive: true,
      });

      await Cart.create({
        userId: user._id,
        items: [{
          productId: product._id,
          productName: 'Comercial 30s',
          broadcasterId: broadcaster._id,
          broadcasterName: 'Rádio Teste',
          productSchedule: 'Rotativo',
          quantity,
          price: 125,
          schedule: {},
        }],
      });

      return { auth, productId: product._id.toString() };
    }

    it('SEGURANCA: recusa agendamento acima da quantidade comprada', async () => {
      const { auth, productId } = await cartWithItem(1);

      const res = await request(app)
        .put('/api/cart/items/schedule')
        .set('Cookie', auth.cookieHeader)
        .set('X-CSRF-Token', auth.csrfHeader)
        .send({ productId, schedule: { '2099-08-01': 50, '2099-08-02': 50 } });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/soma do agendamento/i);

      // O agendamento rejeitado NAO pode ter sido persistido.
      // `schedule` e um Map do Mongoose — Object.keys devolveria props internas.
      const cart = await Cart.findOne({});
      const saved = (cart!.items[0] as any).schedule;
      const entryCount = saved instanceof Map ? saved.size : Object.keys(saved || {}).length;
      expect(entryCount).toBe(0);
    });

    it('aceita agendamento que bate com a quantidade', async () => {
      const { auth, productId } = await cartWithItem(4);

      const res = await request(app)
        .put('/api/cart/items/schedule')
        .set('Cookie', auth.cookieHeader)
        .set('X-CSRF-Token', auth.csrfHeader)
        .send({ productId, schedule: { '2099-08-01': 2, '2099-08-02': 2 } });

      expect(res.status).toBe(200);
    });
  });
});
