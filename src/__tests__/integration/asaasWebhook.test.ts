/**
 * Integration Tests — Asaas Webhook
 *
 * Endpoint: POST /api/payment/asaas-webhook
 *
 * Garante:
 *  - Autenticação via header `asaas-access-token` (não JWT/cookie)
 *  - Resposta sempre 200 quando token válido (idempotente, evita retries do Asaas)
 *  - Mutação correta do Order conforme o evento
 *  - Idempotência em PAYMENT_CONFIRMED reentregue
 */

import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';
import express from 'express';
import cookieParser from 'cookie-parser';

import { mongoSanitize, xssSanitize, dedupeQuery } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';
import paymentRoutes from '../../routes/paymentRoutes';

import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { createAdvertiser, createBroadcaster } from '../helpers/authHelper';
import Order from '../../models/Order';

const WEBHOOK_TOKEN = 'webhook-test-token';

function createWebhookTestApp(): Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(mongoSanitize);
  app.use(xssSanitize);
  app.use(dedupeQuery);
  app.use(csrfProtection);
  app.use('/api/payment', paymentRoutes);
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
  app = createWebhookTestApp();
});

afterEach(async () => {
  await clearTestDB();
});

afterAll(async () => {
  await disconnectTestDB();
});

/**
 * Helper: cria um Order PIX pendente com asaasPaymentId.
 */
async function createPendingPixOrder(asaasPaymentId: string) {
  const { user: buyer } = await createAdvertiser();
  const { user: broadcaster } = await createBroadcaster();

  return Order.create({
    buyerId: buyer._id,
    buyerName: 'Comprador',
    buyerEmail: 'comprador@teste.com.br',
    buyerPhone: '11999999999',
    buyerDocument: '00000000000',
    items: [
      {
        productId: '507f1f77bcf86cd799439011',
        productName: 'Comercial 30s',
        broadcasterName: 'Rádio Teste',
        broadcasterId: broadcaster._id.toString(),
        quantity: 5,
        unitPrice: 100,
        totalPrice: 500,
        schedule: new Map(),
        material: { type: 'text', text: '', status: 'pending_broadcaster_review', chat: [] },
      },
    ],
    payment: {
      method: 'pix',
      status: 'pending',
      asaasPaymentId,
      pixQrCode: 'base64img',
      pixCopyPaste: '00020126',
      walletAmountUsed: 0,
      chargedAmount: 525,
      totalAmount: 525,
    },
    splits: [],
    status: 'pending_payment',
    grossAmount: 500,
    broadcasterAmount: 375,
    platformSplit: 125,
    techFee: 25,
    agencyCommission: 0,
    monitoringCost: 0,
    totalAmount: 525,
    subtotal: 500,
    platformFee: 25,
    billingInvoices: [],
    billingDocuments: [],
    broadcasterInvoices: [],
    opecs: [],
    notifications: [],
    webhookLogs: [],
  });
}

/**
 * Helper: cria um Order já pago (para testar refund e idempotência).
 */
async function createPaidOrder(asaasPaymentId: string) {
  const { user: buyer } = await createAdvertiser();
  const { user: broadcaster } = await createBroadcaster();

  return Order.create({
    buyerId: buyer._id,
    buyerName: 'Comprador',
    buyerEmail: 'comprador@teste.com.br',
    buyerPhone: '11999999999',
    buyerDocument: '00000000000',
    items: [
      {
        productId: '507f1f77bcf86cd799439011',
        productName: 'Comercial 30s',
        broadcasterName: 'Rádio Teste',
        broadcasterId: broadcaster._id.toString(),
        quantity: 5,
        unitPrice: 100,
        totalPrice: 500,
        schedule: new Map(),
        material: { type: 'text', text: '', status: 'pending_broadcaster_review', chat: [] },
      },
    ],
    payment: {
      method: 'pix',
      status: 'received',
      asaasPaymentId,
      paidAt: new Date(),
      walletAmountUsed: 0,
      chargedAmount: 525,
      totalAmount: 525,
    },
    splits: [],
    status: 'paid',
    grossAmount: 500,
    broadcasterAmount: 375,
    platformSplit: 125,
    techFee: 25,
    agencyCommission: 0,
    monitoringCost: 0,
    totalAmount: 525,
    subtotal: 500,
    platformFee: 25,
    paidAt: new Date(),
    billingInvoices: [],
    billingDocuments: [],
    broadcasterInvoices: [],
    opecs: [],
    notifications: [],
    webhookLogs: [],
  });
}

describe('POST /api/payment/asaas-webhook — autenticação', () => {
  it('retorna 401 sem header de token', async () => {
    const res = await request(app)
      .post('/api/payment/asaas-webhook')
      .send({ event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_x' } });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/token/i);
  });

  it('retorna 401 com token inválido', async () => {
    const res = await request(app)
      .post('/api/payment/asaas-webhook')
      .set('asaas-access-token', 'wrong-token')
      .send({ event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_x' } });

    expect(res.status).toBe(401);
  });
});

describe('POST /api/payment/asaas-webhook — payload', () => {
  it('retorna 200 e skipped quando payload sem event/payment.id', async () => {
    const res = await request(app)
      .post('/api/payment/asaas-webhook')
      .set('asaas-access-token', WEBHOOK_TOKEN)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
    expect(res.body.skipped).toBeDefined();
  });

  it('retorna 200 e skipped quando order não encontrada', async () => {
    const res = await request(app)
      .post('/api/payment/asaas-webhook')
      .set('asaas-access-token', WEBHOOK_TOKEN)
      .send({ event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_unknown_999' } });

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
    expect(res.body.skipped).toMatch(/order not found/);
  });

  it('retorna 200 e ignora evento desconhecido', async () => {
    await createPendingPixOrder('pay_pix_unknown');

    const res = await request(app)
      .post('/api/payment/asaas-webhook')
      .set('asaas-access-token', WEBHOOK_TOKEN)
      .send({ event: 'UNKNOWN_EVENT', payment: { id: 'pay_pix_unknown' } });

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);

    const order = await Order.findOne({ 'payment.asaasPaymentId': 'pay_pix_unknown' });
    // Estado não pode mudar
    expect(order!.status).toBe('pending_payment');
    expect((order!.payment as any).status).toBe('pending');
  });
});

describe('POST /api/payment/asaas-webhook — eventos de confirmação', () => {
  it('PAYMENT_CONFIRMED transiciona pedido para paid + paidAt', async () => {
    await createPendingPixOrder('pay_pix_confirm_1');

    const res = await request(app)
      .post('/api/payment/asaas-webhook')
      .set('asaas-access-token', WEBHOOK_TOKEN)
      .send({ event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_pix_confirm_1' } });

    expect(res.status).toBe(200);

    const order = await Order.findOne({ 'payment.asaasPaymentId': 'pay_pix_confirm_1' });
    expect(order!.status).toBe('paid');
    expect((order!.payment as any).status).toBe('received');
    expect((order!.payment as any).paidAt).toBeInstanceOf(Date);
  });

  it('PAYMENT_RECEIVED transiciona pedido para paid + paidAt', async () => {
    await createPendingPixOrder('pay_pix_received_1');

    const res = await request(app)
      .post('/api/payment/asaas-webhook')
      .set('asaas-access-token', WEBHOOK_TOKEN)
      .send({ event: 'PAYMENT_RECEIVED', payment: { id: 'pay_pix_received_1' } });

    expect(res.status).toBe(200);

    const order = await Order.findOne({ 'payment.asaasPaymentId': 'pay_pix_received_1' });
    expect(order!.status).toBe('paid');
    expect((order!.payment as any).status).toBe('received');
    expect((order!.payment as any).paidAt).toBeInstanceOf(Date);
  });

  it('é idempotente quando PAYMENT_CONFIRMED chega para Order já paga', async () => {
    await createPaidOrder('pay_already_paid_1');

    const res = await request(app)
      .post('/api/payment/asaas-webhook')
      .set('asaas-access-token', WEBHOOK_TOKEN)
      .send({ event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_already_paid_1' } });

    expect(res.status).toBe(200);
    expect(res.body.idempotent).toBe(true);

    const order = await Order.findOne({ 'payment.asaasPaymentId': 'pay_already_paid_1' });
    expect(order!.status).toBe('paid');
  });
});

describe('POST /api/payment/asaas-webhook — overdue e refund', () => {
  it('PAYMENT_OVERDUE marca payment.status = failed', async () => {
    await createPendingPixOrder('pay_pix_overdue_1');

    const res = await request(app)
      .post('/api/payment/asaas-webhook')
      .set('asaas-access-token', WEBHOOK_TOKEN)
      .send({ event: 'PAYMENT_OVERDUE', payment: { id: 'pay_pix_overdue_1' } });

    expect(res.status).toBe(200);

    const order = await Order.findOne({ 'payment.asaasPaymentId': 'pay_pix_overdue_1' });
    expect((order!.payment as any).status).toBe('failed');
    // Status do pedido permanece (admin decide se cancela)
    expect(order!.status).toBe('pending_payment');
  });

  it('PAYMENT_REFUNDED transiciona pedido para refunded', async () => {
    await createPaidOrder('pay_pix_refund_1');

    const res = await request(app)
      .post('/api/payment/asaas-webhook')
      .set('asaas-access-token', WEBHOOK_TOKEN)
      .send({ event: 'PAYMENT_REFUNDED', payment: { id: 'pay_pix_refund_1' } });

    expect(res.status).toBe(200);

    const order = await Order.findOne({ 'payment.asaasPaymentId': 'pay_pix_refund_1' });
    expect(order!.status).toBe('refunded');
    expect((order!.payment as any).status).toBe('refunded');
  });
});
