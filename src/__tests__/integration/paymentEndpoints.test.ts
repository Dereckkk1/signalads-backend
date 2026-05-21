/**
 * Integration Tests — Payment Endpoints (PIX QR + status polling)
 *
 * Endpoints cobertos:
 *  - GET /api/payment/pix/:orderId
 *  - GET /api/payment/status/:orderId
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
import { createAdvertiser, createBroadcaster, createAdmin } from '../helpers/authHelper';
import Order from '../../models/Order';

function createPaymentTestApp(): Application {
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
  await connectTestDB();
  app = createPaymentTestApp();
});

afterEach(async () => {
  await clearTestDB();
});

afterAll(async () => {
  await disconnectTestDB();
});

/**
 * Cria um Order PIX com QR code já populado.
 */
async function createPixOrderForBuyer(buyerId: string) {
  const { user: broadcaster } = await createBroadcaster();

  return Order.create({
    buyerId,
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
      asaasPaymentId: 'pay_pix_endpoint',
      asaasInvoiceUrl: 'https://sandbox.asaas.com/i/pix',
      pixQrCode: 'base64-qr-code-fake',
      pixCopyPaste: '00020126360014BR.GOV.BCB.PIX',
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
 * Cria um Order com método de pagamento diferente de PIX.
 */
async function createCreditCardOrderForBuyer(buyerId: string) {
  const { user: broadcaster } = await createBroadcaster();

  return Order.create({
    buyerId,
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
      method: 'credit_card',
      status: 'received',
      asaasPaymentId: 'pay_cc_endpoint',
      walletAmountUsed: 0,
      chargedAmount: 525,
      totalAmount: 525,
      paidAt: new Date(),
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

describe('GET /api/payment/pix/:orderId', () => {
  it('retorna 401 sem autenticação', async () => {
    const { user: buyer } = await createAdvertiser();
    const order = await createPixOrderForBuyer(buyer._id.toString());

    const res = await request(app).get(`/api/payment/pix/${order._id}`);

    expect(res.status).toBe(401);
  });

  it('retorna 200 com QR + copia-cola para o dono do pedido', async () => {
    const { user: buyer, auth } = await createAdvertiser();
    const order = await createPixOrderForBuyer(buyer._id.toString());

    const res = await request(app)
      .get(`/api/payment/pix/${order._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.pixQrCode).toBe('base64-qr-code-fake');
    expect(res.body.pixCopyPaste).toBe('00020126360014BR.GOV.BCB.PIX');
    expect(res.body.status).toBe('pending');
    expect(res.body.asaasInvoiceUrl).toBe('https://sandbox.asaas.com/i/pix');
  });

  it('retorna 200 para admin (mesmo não sendo dono)', async () => {
    const { user: buyer } = await createAdvertiser();
    const { auth: adminAuth } = await createAdmin();
    const order = await createPixOrderForBuyer(buyer._id.toString());

    const res = await request(app)
      .get(`/api/payment/pix/${order._id}`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.pixQrCode).toBe('base64-qr-code-fake');
  });

  it('retorna 403 para outro usuário não-admin', async () => {
    const { user: buyer } = await createAdvertiser();
    const { auth: otherAuth } = await createAdvertiser();
    const order = await createPixOrderForBuyer(buyer._id.toString());

    const res = await request(app)
      .get(`/api/payment/pix/${order._id}`)
      .set('Cookie', otherAuth.cookieHeader)
      .set('X-CSRF-Token', otherAuth.csrfHeader);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/negado/i);
  });

  it('retorna 404 quando pedido não existe', async () => {
    const { auth } = await createAdvertiser();
    const fakeId = '507f1f77bcf86cd799439999';

    const res = await request(app)
      .get(`/api/payment/pix/${fakeId}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(404);
  });

  it('retorna 400 quando pedido não é PIX', async () => {
    const { user: buyer, auth } = await createAdvertiser();
    const order = await createCreditCardOrderForBuyer(buyer._id.toString());

    const res = await request(app)
      .get(`/api/payment/pix/${order._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/pix/i);
  });
});

describe('GET /api/payment/status/:orderId', () => {
  it('retorna 401 sem autenticação', async () => {
    const { user: buyer } = await createAdvertiser();
    const order = await createPixOrderForBuyer(buyer._id.toString());

    const res = await request(app).get(`/api/payment/status/${order._id}`);

    expect(res.status).toBe(401);
  });

  it('retorna 200 com status do pedido para o dono (polling)', async () => {
    const { user: buyer, auth } = await createAdvertiser();
    const order = await createPixOrderForBuyer(buyer._id.toString());

    const res = await request(app)
      .get(`/api/payment/status/${order._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.orderStatus).toBe('pending_payment');
    expect(res.body.paymentStatus).toBe('pending');
    expect(res.body.paymentMethod).toBe('pix');
  });

  it('retorna 200 com paidAt quando pedido já foi pago', async () => {
    const { user: buyer, auth } = await createAdvertiser();
    const order = await createCreditCardOrderForBuyer(buyer._id.toString());

    const res = await request(app)
      .get(`/api/payment/status/${order._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.orderStatus).toBe('paid');
    expect(res.body.paymentStatus).toBe('received');
    expect(res.body.paymentMethod).toBe('credit_card');
    expect(res.body.paidAt).toBeDefined();
  });

  it('retorna 403 para outro usuário não-admin', async () => {
    const { user: buyer } = await createAdvertiser();
    const { auth: otherAuth } = await createAdvertiser();
    const order = await createPixOrderForBuyer(buyer._id.toString());

    const res = await request(app)
      .get(`/api/payment/status/${order._id}`)
      .set('Cookie', otherAuth.cookieHeader)
      .set('X-CSRF-Token', otherAuth.csrfHeader);

    expect(res.status).toBe(403);
  });

  it('retorna 404 quando pedido não existe', async () => {
    const { auth } = await createAdvertiser();
    const fakeId = '507f1f77bcf86cd799439999';

    const res = await request(app)
      .get(`/api/payment/status/${fakeId}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(404);
  });
});
