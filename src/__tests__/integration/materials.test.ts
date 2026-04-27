/**
 * Integration Tests — Materials API
 *
 * Tests real HTTP endpoints end-to-end.
 * GET    /api/materials/:orderId/item/:itemIndex/chat
 * POST   /api/materials/:orderId/item/:itemIndex/message
 * POST   /api/materials/:orderId/item/:itemIndex/broadcaster/reject
 * POST   /api/materials/:orderId/item/:itemIndex/broadcaster/approve
 * POST   /api/materials/:orderId/item/:itemIndex/client/approve
 * POST   /api/materials/:orderId/item/:itemIndex/client/reject
 */

import '../helpers/mocks';

// Mock storage uploadFile to avoid GCS dependency
jest.mock('../../config/storage', () => ({
  uploadFile: jest.fn().mockResolvedValue('https://storage.example.com/test-audio.mp3'),
}));

import request from 'supertest';
import { Application } from 'express';
import mongoose from 'mongoose';
import express from 'express';
import cookieParser from 'cookie-parser';

import { mongoSanitize, xssSanitize, dedupeQuery } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';
import materialRoutes from '../../routes/materialRoutes';

import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import {
  createAdvertiser,
  createBroadcaster,
  createAgency,
} from '../helpers/authHelper';
import { Product } from '../../models/Product';
import Order from '../../models/Order';

function createMaterialTestApp(): Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(mongoSanitize);
  app.use(xssSanitize);
  app.use(dedupeQuery);
  app.use(csrfProtection);
  app.use('/api/materials', materialRoutes);
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
  app = createMaterialTestApp();
});

afterEach(async () => {
  await clearTestDB();
});

afterAll(async () => {
  await disconnectTestDB();
});

type MaterialStatus = 'pending_broadcaster_review' | 'broadcaster_rejected' | 'broadcaster_approved' | 'broadcaster_produced' | 'client_approved' | 'client_rejected' | 'final_approved';

/**
 * Helper: creates a complete order scenario with buyer, broadcaster, and material.
 */
async function createOrderWithMaterial(materialStatus: MaterialStatus = 'pending_broadcaster_review') {
  const { user: advertiser, auth: advertiserAuth } = await createAdvertiser();
  const { user: broadcaster, auth: broadcasterAuth } = await createBroadcaster();

  const product = await Product.create({
    broadcasterId: broadcaster._id,
    spotType: 'Comercial 30s',
    duration: 30,
    timeSlot: 'Rotativo',
    netPrice: 100,
    pricePerInsertion: 125,
    isActive: true,
  });

  const order = await Order.create({
    buyerId: advertiser._id,
    buyerName: 'Advertiser Co',
    buyerEmail: advertiser.email,
    buyerPhone: '11999999999',
    buyerDocument: '12345678901234',
    items: [
      {
        productId: product._id.toString(),
        productName: 'Comercial 30s',
        broadcasterName: 'Radio Test FM',
        broadcasterId: broadcaster._id.toString(),
        quantity: 10,
        unitPrice: 125,
        totalPrice: 1250,
        schedule: {},
        material: {
          type: 'audio',
          audioUrl: 'https://example.com/audio.mp3',
          audioFileName: 'audio.mp3',
          status: materialStatus,
          chat: [],
        },
      },
    ],
    payment: {
      method: 'pending_contact',
      status: 'confirmed',
      walletAmountUsed: 0,
      chargedAmount: 1312.5,
      totalAmount: 1312.5,
    },
    splits: [],
    status: 'approved',
    grossAmount: 1250,
    broadcasterAmount: 937.5,
    platformSplit: 250,
    techFee: 62.5,
    agencyCommission: 0,
    monitoringCost: 0,
    isMonitoringEnabled: false,
    totalAmount: 1312.5,
    subtotal: 1250,
    platformFee: 62.5,
    billingInvoices: [],
    billingDocuments: [],
    broadcasterInvoices: [],
    opecs: [],
    notifications: [],
    webhookLogs: [],
  });

  return { advertiser, advertiserAuth, broadcaster, broadcasterAuth, product, order };
}

// ─────────────────────────────────────────────────
// GET /api/materials/:orderId/item/:itemIndex/chat
// ─────────────────────────────────────────────────
describe('GET /api/materials/:orderId/item/:itemIndex/chat', () => {
  it('should return chat history for the broadcaster', async () => {
    const { broadcasterAuth, order } = await createOrderWithMaterial();

    const res = await request(app)
      .get(`/api/materials/${order._id}/item/0/chat`)
      .set('Cookie', broadcasterAuth.cookieHeader)
      .set('X-CSRF-Token', broadcasterAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.chat).toBeDefined();
    expect(Array.isArray(res.body.chat)).toBe(true);
    expect(res.body.materialStatus).toBe('pending_broadcaster_review');
  });

  it('should return chat history for the client (buyer)', async () => {
    const { advertiserAuth, order } = await createOrderWithMaterial();

    const res = await request(app)
      .get(`/api/materials/${order._id}/item/0/chat`)
      .set('Cookie', advertiserAuth.cookieHeader)
      .set('X-CSRF-Token', advertiserAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.chat).toBeDefined();
  });

  it('should return 403 for unrelated user', async () => {
    const { order } = await createOrderWithMaterial();
    const { auth: otherAuth } = await createAdvertiser();

    const res = await request(app)
      .get(`/api/materials/${order._id}/item/0/chat`)
      .set('Cookie', otherAuth.cookieHeader)
      .set('X-CSRF-Token', otherAuth.csrfHeader);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/permissão/i);
  });

  it('should return 404 for non-existent order', async () => {
    const { broadcasterAuth } = await createOrderWithMaterial();
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .get(`/api/materials/${fakeId}/item/0/chat`)
      .set('Cookie', broadcasterAuth.cookieHeader)
      .set('X-CSRF-Token', broadcasterAuth.csrfHeader);

    expect(res.status).toBe(404);
  });

  it('should return 401 when unauthenticated', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app).get(`/api/materials/${fakeId}/item/0/chat`);
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────
// POST /api/materials/:orderId/item/:itemIndex/message
// ─────────────────────────────────────────────────
describe('POST /api/materials/:orderId/item/:itemIndex/message', () => {
  it('should allow broadcaster to send a message', async () => {
    const { broadcasterAuth, order } = await createOrderWithMaterial();

    const res = await request(app)
      .post(`/api/materials/${order._id}/item/0/message`)
      .set('Cookie', broadcasterAuth.cookieHeader)
      .set('X-CSRF-Token', broadcasterAuth.csrfHeader)
      .send({ message: 'Recebemos o material!' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message.sender).toBe('broadcaster');
    expect(res.body.message.message).toBe('Recebemos o material!');
  });

  it('should allow client to send a message', async () => {
    const { advertiserAuth, order } = await createOrderWithMaterial();

    const res = await request(app)
      .post(`/api/materials/${order._id}/item/0/message`)
      .set('Cookie', advertiserAuth.cookieHeader)
      .set('X-CSRF-Token', advertiserAuth.csrfHeader)
      .send({ message: 'Quando fica pronto?' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message.sender).toBe('client');
  });

  it('should reject message from unrelated user', async () => {
    const { order } = await createOrderWithMaterial();
    const { auth: otherAuth } = await createAdvertiser();

    const res = await request(app)
      .post(`/api/materials/${order._id}/item/0/message`)
      .set('Cookie', otherAuth.cookieHeader)
      .set('X-CSRF-Token', otherAuth.csrfHeader)
      .send({ message: 'Intruso' });

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────
// POST /api/materials/:orderId/item/:itemIndex/broadcaster/reject
// ─────────────────────────────────────────────────
describe('POST /api/materials/:orderId/item/:itemIndex/broadcaster/reject', () => {
  it('should allow broadcaster to reject material', async () => {
    const { broadcasterAuth, order } = await createOrderWithMaterial();

    const res = await request(app)
      .post(`/api/materials/${order._id}/item/0/broadcaster/reject`)
      .set('Cookie', broadcasterAuth.cookieHeader)
      .set('X-CSRF-Token', broadcasterAuth.csrfHeader)
      .send({ reason: 'Audio com ruido' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const updated = await Order.findById(order._id);
    expect(updated!.items[0]!.material!.status).toBe('broadcaster_rejected');
  });

  it('should reject when not the owner broadcaster', async () => {
    const { order } = await createOrderWithMaterial();
    const { auth: otherAuth } = await createBroadcaster();

    const res = await request(app)
      .post(`/api/materials/${order._id}/item/0/broadcaster/reject`)
      .set('Cookie', otherAuth.cookieHeader)
      .set('X-CSRF-Token', otherAuth.csrfHeader)
      .send({ reason: 'Nao tenho permissao' });

    expect(res.status).toBe(403);
  });

  it('should reject when advertiser tries to use broadcaster endpoint', async () => {
    const { advertiserAuth, order } = await createOrderWithMaterial();

    const res = await request(app)
      .post(`/api/materials/${order._id}/item/0/broadcaster/reject`)
      .set('Cookie', advertiserAuth.cookieHeader)
      .set('X-CSRF-Token', advertiserAuth.csrfHeader)
      .send({ reason: 'Nao deveria funcionar' });

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────
// POST /api/materials/:orderId/item/:itemIndex/broadcaster/approve
// ─────────────────────────────────────────────────
describe('POST /api/materials/:orderId/item/:itemIndex/broadcaster/approve', () => {
  it('should allow broadcaster to approve material', async () => {
    const { broadcasterAuth, order } = await createOrderWithMaterial();

    const res = await request(app)
      .post(`/api/materials/${order._id}/item/0/broadcaster/approve`)
      .set('Cookie', broadcasterAuth.cookieHeader)
      .set('X-CSRF-Token', broadcasterAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const updated = await Order.findById(order._id);
    expect(updated!.items[0]!.material!.status).toBe('final_approved');
  });

  it('should reject when not the owner broadcaster', async () => {
    const { order } = await createOrderWithMaterial();
    const { auth: otherAuth } = await createBroadcaster();

    const res = await request(app)
      .post(`/api/materials/${order._id}/item/0/broadcaster/approve`)
      .set('Cookie', otherAuth.cookieHeader)
      .set('X-CSRF-Token', otherAuth.csrfHeader);

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────
// POST /api/materials/:orderId/item/:itemIndex/client/approve
// ─────────────────────────────────────────────────
describe('POST /api/materials/:orderId/item/:itemIndex/client/approve', () => {
  it('should allow client to approve broadcaster production', async () => {
    const { advertiserAuth, order } = await createOrderWithMaterial('broadcaster_produced');

    const res = await request(app)
      .post(`/api/materials/${order._id}/item/0/client/approve`)
      .set('Cookie', advertiserAuth.cookieHeader)
      .set('X-CSRF-Token', advertiserAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const updated = await Order.findById(order._id);
    expect(updated!.items[0]!.material!.status).toBe('final_approved');
  });

  it('should reject when broadcaster tries to use client endpoint', async () => {
    const { broadcasterAuth, order } = await createOrderWithMaterial('broadcaster_produced');

    const res = await request(app)
      .post(`/api/materials/${order._id}/item/0/client/approve`)
      .set('Cookie', broadcasterAuth.cookieHeader)
      .set('X-CSRF-Token', broadcasterAuth.csrfHeader);

    expect(res.status).toBe(403);
  });

  it('should reject when a different client tries to approve', async () => {
    const { order } = await createOrderWithMaterial('broadcaster_produced');
    const { auth: otherAuth } = await createAdvertiser();

    const res = await request(app)
      .post(`/api/materials/${order._id}/item/0/client/approve`)
      .set('Cookie', otherAuth.cookieHeader)
      .set('X-CSRF-Token', otherAuth.csrfHeader);

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────
// POST /api/materials/:orderId/item/:itemIndex/client/reject
// ─────────────────────────────────────────────────
describe('POST /api/materials/:orderId/item/:itemIndex/client/reject', () => {
  it('should allow client to reject broadcaster production', async () => {
    const { advertiserAuth, order } = await createOrderWithMaterial('broadcaster_produced');

    const res = await request(app)
      .post(`/api/materials/${order._id}/item/0/client/reject`)
      .set('Cookie', advertiserAuth.cookieHeader)
      .set('X-CSRF-Token', advertiserAuth.csrfHeader)
      .send({ reason: 'Nao ficou bom, precisa regravar' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const updated = await Order.findById(order._id);
    expect(updated!.items[0]!.material!.status).toBe('client_rejected');
  });

  it('should reject when broadcaster tries to use client reject endpoint', async () => {
    const { broadcasterAuth, order } = await createOrderWithMaterial('broadcaster_produced');

    const res = await request(app)
      .post(`/api/materials/${order._id}/item/0/client/reject`)
      .set('Cookie', broadcasterAuth.cookieHeader)
      .set('X-CSRF-Token', broadcasterAuth.csrfHeader)
      .send({ reason: 'Nao deveria funcionar' });

    expect(res.status).toBe(403);
  });

  it('should allow agency user to reject as client', async () => {
    const { user: agency, auth: agencyAuth } = await createAgency();
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

    const order = await Order.create({
      buyerId: agency._id,
      buyerName: 'Agency Co',
      buyerEmail: agency.email,
      buyerPhone: '11999999999',
      buyerDocument: '12345678901234',
      items: [{
        productId: product._id.toString(),
        productName: 'Comercial 30s',
        broadcasterName: 'Radio Test FM',
        broadcasterId: broadcaster._id.toString(),
        quantity: 5,
        unitPrice: 125,
        totalPrice: 625,
        schedule: {},
        material: {
          type: 'recording',
          status: 'broadcaster_produced',
          chat: [],
        },
      }],
      payment: { method: 'pending_contact', status: 'confirmed', walletAmountUsed: 0, chargedAmount: 625, totalAmount: 625 },
      splits: [],
      status: 'approved',
      grossAmount: 625,
      broadcasterAmount: 468.75,
      platformSplit: 125,
      techFee: 31.25,
      agencyCommission: 0,
      monitoringCost: 0,
      isMonitoringEnabled: false,
      totalAmount: 656.25,
      subtotal: 625,
      platformFee: 31.25,
      billingInvoices: [],
      billingDocuments: [],
      broadcasterInvoices: [],
      opecs: [],
      notifications: [],
      webhookLogs: [],
    });

    const res = await request(app)
      .post(`/api/materials/${order._id}/item/0/client/reject`)
      .set('Cookie', agencyAuth.cookieHeader)
      .set('X-CSRF-Token', agencyAuth.csrfHeader)
      .send({ reason: 'Precisa regravar com outra locucao' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
