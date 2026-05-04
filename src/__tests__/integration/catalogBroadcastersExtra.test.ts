/**
 * Integration Tests — Catalog Broadcasters API (Extra Coverage)
 *
 * Cobre funções ainda não testadas em catalogBroadcasterController.ts:
 * - completeCatalogProfile
 * - uploadCatalogLogo
 * - uploadOpec / getOrderOpecs / deleteOpec
 * - getCatalogOrders
 */

import '../helpers/mocks';

jest.mock('../../config/storage', () => ({
  uploadFile: jest.fn().mockResolvedValue('https://storage.googleapis.com/test-bucket/test.jpg'),
}));

import request from 'supertest';
import { Application } from 'express';
import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';

import { mongoSanitize, xssSanitize, dedupeQuery } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';
import adminRoutes from '../../routes/adminRoutes';

import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { createAdmin, createBroadcaster, createAdvertiser } from '../helpers/authHelper';
import { User } from '../../models/User';
import Order from '../../models/Order';

function createApp(): Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(mongoSanitize);
  app.use(xssSanitize);
  app.use(dedupeQuery);
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

async function createCatalogBroadcaster(adminAuth: any) {
  const res = await request(app)
    .post('/api/admin/catalog-broadcasters')
    .set('Cookie', adminAuth.cookieHeader)
    .set('X-CSRF-Token', adminAuth.csrfHeader)
    .send({
      email: `catalog-${Date.now()}-${Math.random().toString(36).slice(2)}@radio.com.br`,
      companyName: 'Rádio Catálogo Teste',
      phone: '11999999999',
    });
  const b = res.body.broadcaster;
  if (!b?.id && !b?._id) {
    throw new Error(`Falha ao criar emissora catálogo: ${JSON.stringify(res.body)}`);
  }
  // Normaliza: some endpoints retornam `id`, outros `_id`
  return { ...b, _id: b._id || b.id };
}

// ─── completeCatalogProfile ───────────────────────────────────────────────

describe('POST /api/admin/catalog-broadcasters/:id/complete-profile', () => {
  it('atualiza perfil completo da emissora catalogo', async () => {
    const { auth: adminAuth } = await createAdmin();
    const broadcaster = await createCatalogBroadcaster(adminAuth);

    const res = await request(app)
      .post(`/api/admin/catalog-broadcasters/${broadcaster._id}/complete-profile`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .send({
        broadcasterProfile: {
          generalInfo: { stationName: 'Rádio Atualizada', dialFrequency: '98.5 FM', band: 'FM' },
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/sucesso/i);
  });

  it('retorna 404 para emissora catalogo inexistente', async () => {
    const { auth: adminAuth } = await createAdmin();

    const res = await request(app)
      .post('/api/admin/catalog-broadcasters/507f1f77bcf86cd799439011/complete-profile')
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .send({ broadcasterProfile: { generalInfo: { stationName: 'X' } } });

    expect(res.status).toBe(404);
  });

  it('retorna 403 para advertiser', async () => {
    const { auth: advertiserAuth } = await createAdvertiser();

    const res = await request(app)
      .post('/api/admin/catalog-broadcasters/507f1f77bcf86cd799439011/complete-profile')
      .set('Cookie', advertiserAuth.cookieHeader)
      .set('X-CSRF-Token', advertiserAuth.csrfHeader)
      .send({ broadcasterProfile: {} });

    expect(res.status).toBe(403);
  });
});

// ─── uploadCatalogLogo ────────────────────────────────────────────────────

describe('POST /api/admin/catalog-broadcasters/:id/upload-logo', () => {
  it('faz upload de logo para emissora catalogo', async () => {
    const { auth: adminAuth } = await createAdmin();
    const broadcaster = await createCatalogBroadcaster(adminAuth);

    const res = await request(app)
      .post(`/api/admin/catalog-broadcasters/${broadcaster._id}/upload-logo`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .attach('logo', Buffer.from('fake-logo'), { filename: 'logo.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body.logoUrl).toBeDefined();
  });

  it('retorna 400 se nenhum arquivo enviado', async () => {
    const { auth: adminAuth } = await createAdmin();
    const broadcaster = await createCatalogBroadcaster(adminAuth);

    const res = await request(app)
      .post(`/api/admin/catalog-broadcasters/${broadcaster._id}/upload-logo`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(400);
  });

  it('retorna 404 para emissora inexistente', async () => {
    const { auth: adminAuth } = await createAdmin();

    const res = await request(app)
      .post('/api/admin/catalog-broadcasters/507f1f77bcf86cd799439011/upload-logo')
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .attach('logo', Buffer.from('data'), { filename: 'logo.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(404);
  });
});

// ─── OPEC upload / get / delete ───────────────────────────────────────────

describe('OPEC endpoints', () => {
  async function createOrderWithBroadcaster(adminAuth: any) {
    const { user: broadcaster } = await createBroadcaster();
    const { user: admin } = await createAdmin();

    const order = await Order.create({
      buyerId: admin._id,
      buyerName: 'Comprador Teste',
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
      payment: { method: 'pending_contact', status: 'pending', walletAmountUsed: 0, chargedAmount: 500, totalAmount: 500 },
      splits: [],
      status: 'approved',
      grossAmount: 500,
      broadcasterAmount: 375,
      platformSplit: 100,
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

    return { broadcaster, order };
  }

  it('POST /api/admin/orders/:id/opec — faz upload de OPEC', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { broadcaster, order } = await createOrderWithBroadcaster(adminAuth);

    const res = await request(app)
      .post(`/api/admin/orders/${order._id}/opec`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .field('broadcasterId', broadcaster._id.toString())
      .field('description', 'Comprovante de veiculação')
      .attach('opec', Buffer.from('fake-pdf'), { filename: 'opec.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(200);
    expect(res.body.opec).toBeDefined();
    expect(res.body.message).toMatch(/sucesso/i);
  });

  it('POST /api/admin/orders/:id/opec — 400 sem arquivo', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { broadcaster, order } = await createOrderWithBroadcaster(adminAuth);

    const res = await request(app)
      .post(`/api/admin/orders/${order._id}/opec`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .send({ broadcasterId: broadcaster._id.toString() });

    expect(res.status).toBe(400);
  });

  it('GET /api/admin/orders/:id/opec — lista OPECs do pedido', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { order } = await createOrderWithBroadcaster(adminAuth);

    const res = await request(app)
      .get(`/api/admin/orders/${order._id}/opec`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.opecs).toBeDefined();
  });

  it('GET /api/admin/orders/:id/opec — 404 para pedido inexistente', async () => {
    const { auth: adminAuth } = await createAdmin();

    const res = await request(app)
      .get('/api/admin/orders/507f1f77bcf86cd799439011/opec')
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(404);
  });

  it('DELETE /api/admin/orders/:id/opec/:opecId — remove OPEC', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { broadcaster, order } = await createOrderWithBroadcaster(adminAuth);

    // Upload primeiro
    await request(app)
      .post(`/api/admin/orders/${order._id}/opec`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .field('broadcasterId', broadcaster._id.toString())
      .attach('opec', Buffer.from('pdf'), { filename: 'opec.pdf', contentType: 'application/pdf' });

    const updatedOrder = await Order.findById(order._id);
    const opecId = (updatedOrder!.opecs as any[])[0]?._id;

    if (opecId) {
      const res = await request(app)
        .delete(`/api/admin/orders/${order._id}/opec/${opecId}`)
        .set('Cookie', adminAuth.cookieHeader)
        .set('X-CSRF-Token', adminAuth.csrfHeader);

      expect(res.status).toBe(200);
    }
  });
});

// ─── getCatalogOrders ─────────────────────────────────────────────────────

describe('GET /api/admin/catalog-orders', () => {
  it('retorna pedidos de emissoras catalogo', async () => {
    const { auth: adminAuth } = await createAdmin();

    const res = await request(app)
      .get('/api/admin/catalog-orders')
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.orders).toBeDefined();
  });

  it('retorna 403 para advertiser', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .get('/api/admin/catalog-orders')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });
});
