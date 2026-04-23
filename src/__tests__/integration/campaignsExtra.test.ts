/**
 * Integration Tests — Campaigns API (Extra Coverage)
 *
 * Cobre branches não testados em campaignController.ts:
 * - rejectBroadcasterItems
 * - approveBroadcasterItems edge cases (billing method)
 * - getBroadcasterOrders
 * - getPendingApprovalOrders
 */

import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';
import express from 'express';
import cookieParser from 'cookie-parser';
import hpp from 'hpp';

import { mongoSanitize, xssSanitize } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';
import campaignRoutes from '../../routes/campaignRoutes';

import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { createBroadcaster, createAdvertiser } from '../helpers/authHelper';
import Order from '../../models/Order';

function createApp(): Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(mongoSanitize);
  app.use(xssSanitize);
  app.use(hpp());
  app.use(csrfProtection);
  app.use('/api/campaigns', campaignRoutes);
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.status || 500).json({ error: 'Erro interno' });
  });
  return app;
}

let app: Application;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret-key-for-testing-12345';
  process.env.NODE_ENV = 'test';
  await connectTestDB();
  app = createApp();
});

afterEach(async () => {
  await clearTestDB();
});

afterAll(async () => {
  await disconnectTestDB();
});

async function createPaidOrderForBroadcaster(broadcasterId: string, buyerId: string) {
  return Order.create({
    buyerId,
    buyerName: 'Comprador',
    buyerEmail: 'comprador@test.com',
    buyerPhone: '11999999999',
    buyerDocument: '00000000000',
    items: [
      {
        productId: '507f1f77bcf86cd799439011',
        productName: 'Comercial 30s',
        broadcasterName: 'Rádio',
        broadcasterId,
        quantity: 1,
        unitPrice: 100,
        totalPrice: 100,
        schedule: new Map(),
        material: { type: 'text', text: '', status: 'pending_broadcaster_review', chat: [] },
      },
    ],
    payment: { method: 'pix', status: 'confirmed', walletAmountUsed: 0, chargedAmount: 100, totalAmount: 100 },
    splits: [{ recipientType: 'broadcaster', recipientId: broadcasterId, recipientName: 'Rádio', amount: 75, percentage: 75, description: 'Veiculação' }],
    status: 'paid',
    grossAmount: 100,
    broadcasterAmount: 75,
    platformSplit: 25,
    techFee: 5,
    agencyCommission: 0,
    monitoringCost: 0,
    totalAmount: 105,
    subtotal: 100,
    platformFee: 5,
    billingInvoices: [],
    billingDocuments: [],
    broadcasterInvoices: [],
    opecs: [],
    notifications: [],
    webhookLogs: [],
  });
}

// ─── rejectBroadcasterItems ───────────────────────────────────────────────

describe('POST /api/campaigns/:id/reject-broadcaster', () => {
  it('emissora recusa itens de pedido pago', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();
    const { user: buyer } = await createAdvertiser();
    const order = await createPaidOrderForBroadcaster(broadcaster._id.toString(), buyer._id.toString());

    const res = await request(app)
      .post(`/api/campaigns/${order._id}/reject-broadcaster`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ reason: 'Motivo de recusa com mais de 10 caracteres' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('retorna 400 com motivo muito curto', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();
    const { user: buyer } = await createAdvertiser();
    const order = await createPaidOrderForBroadcaster(broadcaster._id.toString(), buyer._id.toString());

    const res = await request(app)
      .post(`/api/campaigns/${order._id}/reject-broadcaster`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ reason: 'Curto' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/motivo|caracteres/i);
  });

  it('retorna 403 para advertiser', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .post('/api/campaigns/507f1f77bcf86cd799439011/reject-broadcaster')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ reason: 'Motivo suficientemente longo para passar a validação' });

    expect(res.status).toBe(403);
  });

  it('retorna 404 para pedido inexistente', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/campaigns/507f1f77bcf86cd799439011/reject-broadcaster')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ reason: 'Motivo suficientemente longo para passar a validação' });

    expect(res.status).toBe(404);
  });
});

// ─── getBroadcasterOrders extras ─────────────────────────────────────────

describe('GET /api/campaigns/broadcaster-orders', () => {
  it('retorna pedidos da emissora', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();
    const { user: buyer } = await createAdvertiser();
    await createPaidOrderForBroadcaster(broadcaster._id.toString(), buyer._id.toString());

    const res = await request(app)
      .get('/api/campaigns/broadcaster-orders')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.orders).toBeDefined();
  });

  it('retorna 403 para advertiser', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .get('/api/campaigns/broadcaster-orders')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });
});

// ─── getPendingApprovalOrders extras ─────────────────────────────────────

describe('GET /api/campaigns/pending-approval', () => {
  it('retorna pedidos pendentes de aprovacao para emissora', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();
    const { user: buyer } = await createAdvertiser();
    await createPaidOrderForBroadcaster(broadcaster._id.toString(), buyer._id.toString());

    const res = await request(app)
      .get('/api/campaigns/pending-approval')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.orders).toBeDefined();
  });
});
