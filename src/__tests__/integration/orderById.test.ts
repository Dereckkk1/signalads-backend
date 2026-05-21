/**
 * Integration Tests — GET /api/orders/:orderId
 *
 * Cobertura:
 *  - 401 sem autenticação
 *  - 200 para owner (buyer)
 *  - 200 para admin (mesmo não sendo owner)
 *  - 403 para outro usuário não-admin
 *  - 404 quando pedido não existe
 */

import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';
import express from 'express';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';

import { mongoSanitize, xssSanitize, dedupeQuery } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';
import orderRoutes from '../../routes/orderRoutes';

import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { createAdvertiser, createBroadcaster, createAdmin } from '../helpers/authHelper';
import Order from '../../models/Order';

function createOrderTestApp(): Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(mongoSanitize);
  app.use(xssSanitize);
  app.use(dedupeQuery);
  app.use(csrfProtection);
  app.use('/api/orders', orderRoutes);
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
  app = createOrderTestApp();
});

afterEach(async () => {
  await clearTestDB();
});

afterAll(async () => {
  await disconnectTestDB();
});

async function createOrderForBuyer(buyerId: string) {
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
      asaasPaymentId: 'pay_order_by_id',
      pixQrCode: 'base64-qr',
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

describe('GET /api/orders/:orderId', () => {
  it('retorna 401 sem autenticação', async () => {
    const { user: buyer } = await createAdvertiser();
    const order = await createOrderForBuyer(buyer._id.toString());

    const res = await request(app).get(`/api/orders/${order._id}`);

    expect(res.status).toBe(401);
  });

  it('retorna 200 com o pedido para o dono', async () => {
    const { user: buyer, auth } = await createAdvertiser();
    const order = await createOrderForBuyer(buyer._id.toString());

    const res = await request(app)
      .get(`/api/orders/${order._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body._id).toBe(order._id.toString());
    expect(res.body.payment.method).toBe('pix');
    expect(res.body.status).toBe('pending_payment');
  });

  it('retorna 200 para admin (mesmo não sendo dono)', async () => {
    const { user: buyer } = await createAdvertiser();
    const { auth: adminAuth } = await createAdmin();
    const order = await createOrderForBuyer(buyer._id.toString());

    const res = await request(app)
      .get(`/api/orders/${order._id}`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body._id).toBe(order._id.toString());
  });

  it('retorna 403 para outro usuário não-admin', async () => {
    const { user: buyer } = await createAdvertiser();
    const { auth: otherAuth } = await createAdvertiser();
    const order = await createOrderForBuyer(buyer._id.toString());

    const res = await request(app)
      .get(`/api/orders/${order._id}`)
      .set('Cookie', otherAuth.cookieHeader)
      .set('X-CSRF-Token', otherAuth.csrfHeader);

    expect(res.status).toBe(403);
  });

  it('retorna 404 quando pedido não existe', async () => {
    const { auth } = await createAdvertiser();
    const fakeId = new mongoose.Types.ObjectId().toString();

    const res = await request(app)
      .get(`/api/orders/${fakeId}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(404);
  });
});
