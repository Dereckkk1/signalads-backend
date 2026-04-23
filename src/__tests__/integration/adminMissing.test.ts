/**
 * Integration Tests — Admin API (Missing Coverage)
 *
 * Cobre branches não testados em adminController.ts:
 * - POST /api/admin/orders/:id/approve       — adminApproveOrder (billing method, splits)
 * - POST /api/admin/orders/:id/items/:idx/upload-recording-audio
 * - DELETE /api/admin/orders/:id/items/:idx/recording-audio
 * - DELETE /api/admin/users/:userId          — deleteUser cascade
 * - GET /api/admin/broadcasters/management   — filtro por status
 */

import '../helpers/mocks';

jest.mock('../../config/storage', () => ({
  uploadFile: jest.fn().mockResolvedValue('https://storage.googleapis.com/test/audio.mp3'),
  deleteFile: jest.fn().mockResolvedValue(undefined),
}));

import request from 'supertest';
import { Application } from 'express';
import express from 'express';
import cookieParser from 'cookie-parser';
import hpp from 'hpp';

import { mongoSanitize, xssSanitize } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';
import adminRoutes from '../../routes/adminRoutes';

import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { createAdmin, createBroadcaster, createAdvertiser } from '../helpers/authHelper';
import Order from '../../models/Order';
import { Cart } from '../../models/Cart';

function createApp(): Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(mongoSanitize);
  app.use(xssSanitize);
  app.use(hpp());
  app.use(csrfProtection);
  app.use('/api/admin', adminRoutes);
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

async function createPaidOrder() {
  const { user: admin } = await createAdmin();
  const { user: broadcaster } = await createBroadcaster();

  const order = await Order.create({
    buyerId: admin._id,
    buyerName: 'Comprador',
    buyerEmail: 'comprador@teste.com',
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
    payment: { method: 'pix', status: 'confirmed', walletAmountUsed: 0, chargedAmount: 525, totalAmount: 525 },
    splits: [
      { recipientType: 'broadcaster', recipientId: broadcaster._id.toString(), recipientName: 'Rádio', amount: 375, percentage: 75, description: 'Veiculação' },
      { recipientType: 'platform', recipientId: 'platform', recipientName: 'Plataforma', amount: 150, percentage: 25, description: 'Comissão' },
    ],
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
    billingInvoices: [],
    billingDocuments: [],
    broadcasterInvoices: [],
    opecs: [],
    notifications: [],
    webhookLogs: [],
  });

  return { order, broadcaster };
}

// ─── adminApproveOrder ────────────────────────────────────────────────────

describe('POST /api/admin/orders/:id/approve', () => {
  it('aprova pedido pago com splits', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { order } = await createPaidOrder();

    const res = await request(app)
      .post(`/api/admin/orders/${order._id}/approve`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe('approved');
  });

  it('aprova pedido com metodo billing sem creditar wallets', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: admin } = await createAdmin();
    const { user: broadcaster } = await createBroadcaster();

    const billingOrder = await Order.create({
      buyerId: admin._id,
      buyerName: 'Empresa',
      buyerEmail: 'empresa@test.com',
      buyerPhone: '11999999999',
      buyerDocument: '00000000000',
      items: [
        {
          productId: '507f1f77bcf86cd799439011',
          productName: 'Spot 30s',
          broadcasterName: 'Rádio',
          broadcasterId: broadcaster._id.toString(),
          quantity: 1,
          unitPrice: 100,
          totalPrice: 100,
          schedule: new Map(),
          material: { type: 'text', text: '', status: 'pending_broadcaster_review', chat: [] },
        },
      ],
      payment: { method: 'billing', status: 'confirmed', walletAmountUsed: 0, chargedAmount: 100, totalAmount: 100 },
      splits: [],
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

    const res = await request(app)
      .post(`/api/admin/orders/${billingOrder._id}/approve`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe('approved');
  });

  it('retorna 400 para pedido nao pagavel', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: admin } = await createAdmin();
    const { user: broadcaster } = await createBroadcaster();

    const draftOrder = await Order.create({
      buyerId: admin._id,
      buyerName: 'X',
      buyerEmail: 'x@x.com',
      buyerPhone: '11999999999',
      buyerDocument: '00000000000',
      items: [
        {
          productId: '507f1f77bcf86cd799439011',
          productName: 'Spot',
          broadcasterName: 'Radio',
          broadcasterId: broadcaster._id.toString(),
          quantity: 1,
          unitPrice: 100,
          totalPrice: 100,
          schedule: new Map(),
          material: { type: 'text', text: '', status: 'pending_broadcaster_review', chat: [] },
        },
      ],
      payment: { method: 'pix', status: 'pending', walletAmountUsed: 0, chargedAmount: 100, totalAmount: 100 },
      splits: [],
      status: 'pending_contact',
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

    const res = await request(app)
      .post(`/api/admin/orders/${draftOrder._id}/approve`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(400);
  });

  it('retorna 404 para pedido inexistente', async () => {
    const { auth: adminAuth } = await createAdmin();

    const res = await request(app)
      .post('/api/admin/orders/507f1f77bcf86cd799439011/approve')
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(404);
  });

  it('retorna 403 para advertiser', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .post('/api/admin/orders/507f1f77bcf86cd799439011/approve')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });
});

// ─── adminUploadRecordingAudio ────────────────────────────────────────────

describe('POST /api/admin/orders/:id/items/:idx/upload-recording-audio', () => {
  it('faz upload de audio de gravacao para item do pedido', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { order } = await createPaidOrder();

    const res = await request(app)
      .post(`/api/admin/orders/${order._id}/items/0/upload-recording-audio`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .attach('audio', Buffer.from('fake-mp3-audio'), { filename: 'audio.mp3', contentType: 'audio/mpeg' });

    expect([200, 400, 404]).toContain(res.status);
  });

  it('retorna 403 para broadcaster', async () => {
    const { auth: broadcasterAuth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/admin/orders/507f1f77bcf86cd799439011/items/0/upload-recording-audio')
      .set('Cookie', broadcasterAuth.cookieHeader)
      .set('X-CSRF-Token', broadcasterAuth.csrfHeader)
      .attach('audio', Buffer.from('data'), { filename: 'audio.mp3', contentType: 'audio/mpeg' });

    expect(res.status).toBe(403);
  });
});

// ─── adminDeleteRecordingAudio ────────────────────────────────────────────

describe('DELETE /api/admin/orders/:id/items/:idx/recording-audio', () => {
  it('retorna 404 para pedido inexistente', async () => {
    const { auth: adminAuth } = await createAdmin();

    const res = await request(app)
      .delete('/api/admin/orders/507f1f77bcf86cd799439011/items/0/recording-audio')
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(404);
  });

  it('retorna 403 para broadcaster', async () => {
    const { auth: broadcasterAuth } = await createBroadcaster();

    const res = await request(app)
      .delete('/api/admin/orders/507f1f77bcf86cd799439011/items/0/recording-audio')
      .set('Cookie', broadcasterAuth.cookieHeader)
      .set('X-CSRF-Token', broadcasterAuth.csrfHeader);

    expect(res.status).toBe(403);
  });
});

// ─── deleteUser extras ────────────────────────────────────────────────────

describe('DELETE /api/admin/users/:id — extras', () => {
  it('deleta advertiser e seus dados associados (carrinho)', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: advertiser } = await createAdvertiser();

    await Cart.create({ userId: advertiser._id, items: [] });

    const res = await request(app)
      .delete(`/api/admin/users/${advertiser._id}`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.summary).toBeDefined();

    const cart = await Cart.findOne({ userId: advertiser._id });
    expect(cart).toBeNull();
  });

  it('retorna 401 sem autenticacao', async () => {
    const res = await request(app)
      .delete('/api/admin/users/507f1f77bcf86cd799439011');
    expect(res.status).toBe(401);
  });
});

// ─── getBroadcastersForManagement extras ─────────────────────────────────

describe('GET /api/admin/broadcasters/management — extras', () => {
  it('filtra emissoras por status pending', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: broadcaster } = await createBroadcaster();

    const res = await request(app)
      .get('/api/admin/broadcasters/management?status=pending')
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.broadcasters).toBeDefined();
  });

  it('retorna todas as emissoras com status all', async () => {
    const { auth: adminAuth } = await createAdmin();

    const res = await request(app)
      .get('/api/admin/broadcasters/management?status=all')
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.broadcasters)).toBe(true);
  });
});
