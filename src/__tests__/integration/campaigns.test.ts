/**
 * Integration Tests — Campaigns API
 *
 * Tests real HTTP endpoints end-to-end.
 * GET    /api/campaigns/my-campaigns
 * GET    /api/campaigns/broadcaster-orders
 * GET    /api/campaigns/pending-approval
 * POST   /api/campaigns/:orderId/approve-broadcaster
 * POST   /api/campaigns/:orderId/reject-broadcaster
 * GET    /api/campaigns/:orderId
 */

import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';
import mongoose from 'mongoose';
import express from 'express';
import cookieParser from 'cookie-parser';

import { mongoSanitize, xssSanitize, dedupeQuery } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';
import campaignRoutes from '../../routes/campaignRoutes';

import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import {
  createAdvertiser,
  createBroadcaster,
  createAgency,
  createAdmin,
} from '../helpers/authHelper';
import { Product } from '../../models/Product';
import Order from '../../models/Order';

function createCampaignTestApp(): Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(mongoSanitize);
  app.use(xssSanitize);
  app.use(dedupeQuery);
  app.use(csrfProtection);
  app.use('/api/campaigns', campaignRoutes);
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
  app = createCampaignTestApp();
});

afterEach(async () => {
  await clearTestDB();
});

afterAll(async () => {
  await disconnectTestDB();
});

/**
 * Helper: creates a full order with buyer, broadcaster, and product.
 */
async function createTestOrder(overrides: Record<string, any> = {}) {
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
          status: 'pending_broadcaster_review',
          chat: [],
        },
      },
    ],
    payment: {
      method: 'pending_contact',
      status: 'pending',
      walletAmountUsed: 0,
      chargedAmount: 1437.5,
      totalAmount: 1437.5,
    },
    splits: [],
    status: 'paid',
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
    ...overrides,
  });

  return { advertiser, advertiserAuth, broadcaster, broadcasterAuth, product, order };
}

// ─────────────────────────────────────────────────
// GET /api/campaigns/my-campaigns (buyer)
// ─────────────────────────────────────────────────
describe('GET /api/campaigns/my-campaigns', () => {
  it('should return campaigns for the authenticated buyer', async () => {
    const { advertiserAuth } = await createTestOrder();

    const res = await request(app)
      .get('/api/campaigns/my-campaigns')
      .set('Cookie', advertiserAuth.cookieHeader)
      .set('X-CSRF-Token', advertiserAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.campaigns).toHaveLength(1);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.total).toBe(1);
  });

  it('should return empty when buyer has no campaigns', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .get('/api/campaigns/my-campaigns')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.campaigns).toHaveLength(0);
    expect(res.body.pagination.total).toBe(0);
  });

  it('should filter by status', async () => {
    const { advertiser, advertiserAuth, broadcaster, product } = await createTestOrder();

    // Create another order with different status
    await Order.create({
      buyerId: advertiser._id,
      buyerName: 'Advertiser Co',
      buyerEmail: advertiser.email,
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
      }],
      payment: { method: 'pending_contact', status: 'pending', walletAmountUsed: 0, chargedAmount: 625, totalAmount: 625 },
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
      .get('/api/campaigns/my-campaigns?status=approved')
      .set('Cookie', advertiserAuth.cookieHeader)
      .set('X-CSRF-Token', advertiserAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.campaigns).toHaveLength(1);
    expect(res.body.campaigns[0].status).toBe('approved');
  });

  it('should return 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/campaigns/my-campaigns');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────
// GET /api/campaigns/broadcaster-orders
// ─────────────────────────────────────────────────
describe('GET /api/campaigns/broadcaster-orders', () => {
  it('should return orders for the broadcaster', async () => {
    const { broadcasterAuth } = await createTestOrder();

    const res = await request(app)
      .get('/api/campaigns/broadcaster-orders')
      .set('Cookie', broadcasterAuth.cookieHeader)
      .set('X-CSRF-Token', broadcasterAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.orders).toHaveLength(1);
    expect(res.body.orders[0].items).toHaveLength(1);
    expect(res.body.pagination).toBeDefined();
  });

  it('should only show items belonging to the broadcaster', async () => {
    const { broadcasterAuth } = await createTestOrder();

    const res = await request(app)
      .get('/api/campaigns/broadcaster-orders')
      .set('Cookie', broadcasterAuth.cookieHeader)
      .set('X-CSRF-Token', broadcasterAuth.csrfHeader);

    expect(res.status).toBe(200);
    // Items are filtered to only show broadcaster's items
    expect(res.body.orders[0].items).toHaveLength(1);
    expect(res.body.orders[0].myTotalItems).toBe(10);
  });

  it('should reject non-broadcaster users', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .get('/api/campaigns/broadcaster-orders')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/emissoras/i);
  });
});

// ─────────────────────────────────────────────────
// GET /api/campaigns/pending-approval
// ─────────────────────────────────────────────────
describe('GET /api/campaigns/pending-approval', () => {
  it('should return pending orders for the broadcaster', async () => {
    const { broadcasterAuth } = await createTestOrder({ status: 'paid' });

    const res = await request(app)
      .get('/api/campaigns/pending-approval')
      .set('Cookie', broadcasterAuth.cookieHeader)
      .set('X-CSRF-Token', broadcasterAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.orders.length).toBeGreaterThanOrEqual(1);
  });

  it('should not return orders with non-pending status', async () => {
    const { broadcasterAuth } = await createTestOrder({ status: 'approved' });

    const res = await request(app)
      .get('/api/campaigns/pending-approval')
      .set('Cookie', broadcasterAuth.cookieHeader)
      .set('X-CSRF-Token', broadcasterAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.orders).toHaveLength(0);
  });

  it('should reject non-broadcaster users', async () => {
    const { auth } = await createAgency();

    const res = await request(app)
      .get('/api/campaigns/pending-approval')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────
// POST /api/campaigns/:orderId/approve-broadcaster
// ─────────────────────────────────────────────────
describe('POST /api/campaigns/:orderId/approve-broadcaster', () => {
  it('should allow broadcaster to approve their items', async () => {
    const { broadcasterAuth, order } = await createTestOrder({ status: 'paid' });

    const res = await request(app)
      .post(`/api/campaigns/${order._id}/approve-broadcaster`)
      .set('Cookie', broadcasterAuth.cookieHeader)
      .set('X-CSRF-Token', broadcasterAuth.csrfHeader);

    expect(res.status).toBe(200);

    const updated = await Order.findById(order._id);
    expect(updated!.status).toBe('approved');
    expect(updated!.approvedAt).toBeDefined();
  });

  it('should reject when order is not in paid/pending_approval status', async () => {
    const { broadcasterAuth, order } = await createTestOrder({ status: 'approved' });

    const res = await request(app)
      .post(`/api/campaigns/${order._id}/approve-broadcaster`)
      .set('Cookie', broadcasterAuth.cookieHeader)
      .set('X-CSRF-Token', broadcasterAuth.csrfHeader);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/não pode ser aprovado/i);
  });

  it('should reject when broadcaster has no items in the order', async () => {
    const { order } = await createTestOrder({ status: 'paid' });
    const { auth: otherBroadcasterAuth } = await createBroadcaster();

    const res = await request(app)
      .post(`/api/campaigns/${order._id}/approve-broadcaster`)
      .set('Cookie', otherBroadcasterAuth.cookieHeader)
      .set('X-CSRF-Token', otherBroadcasterAuth.csrfHeader);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/não tem itens/i);
  });

  it('should return 404 for non-existent order', async () => {
    const { broadcasterAuth } = await createTestOrder({ status: 'paid' });
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .post(`/api/campaigns/${fakeId}/approve-broadcaster`)
      .set('Cookie', broadcasterAuth.cookieHeader)
      .set('X-CSRF-Token', broadcasterAuth.csrfHeader);

    expect(res.status).toBe(404);
  });

  it('should reject non-broadcaster users', async () => {
    const { advertiserAuth, order } = await createTestOrder({ status: 'paid' });

    const res = await request(app)
      .post(`/api/campaigns/${order._id}/approve-broadcaster`)
      .set('Cookie', advertiserAuth.cookieHeader)
      .set('X-CSRF-Token', advertiserAuth.csrfHeader);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/emissoras/i);
  });
});

// ─────────────────────────────────────────────────
// POST /api/campaigns/:orderId/reject-broadcaster
// ─────────────────────────────────────────────────
describe('POST /api/campaigns/:orderId/reject-broadcaster', () => {
  it('should allow broadcaster to reject with valid reason', async () => {
    const { broadcasterAuth, order } = await createTestOrder({ status: 'paid' });

    const res = await request(app)
      .post(`/api/campaigns/${order._id}/reject-broadcaster`)
      .set('Cookie', broadcasterAuth.cookieHeader)
      .set('X-CSRF-Token', broadcasterAuth.csrfHeader)
      .send({ reason: 'Nao consigo atender neste periodo por questoes operacionais' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const updated = await Order.findById(order._id);
    expect(updated!.status).toBe('cancelled');
    expect(updated!.cancellationReason).toMatch(/Recusado pela emissora/);
  });

  it('should reject when reason is too short', async () => {
    const { broadcasterAuth, order } = await createTestOrder({ status: 'paid' });

    const res = await request(app)
      .post(`/api/campaigns/${order._id}/reject-broadcaster`)
      .set('Cookie', broadcasterAuth.cookieHeader)
      .set('X-CSRF-Token', broadcasterAuth.csrfHeader)
      .send({ reason: 'Curto' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/mínimo 10 caracteres/i);
  });

  it('should reject when reason is missing', async () => {
    const { broadcasterAuth, order } = await createTestOrder({ status: 'paid' });

    const res = await request(app)
      .post(`/api/campaigns/${order._id}/reject-broadcaster`)
      .set('Cookie', broadcasterAuth.cookieHeader)
      .set('X-CSRF-Token', broadcasterAuth.csrfHeader)
      .send({});

    expect(res.status).toBe(400);
  });

  it('should reject when order is not in correct status', async () => {
    const { broadcasterAuth, order } = await createTestOrder({ status: 'completed' });

    const res = await request(app)
      .post(`/api/campaigns/${order._id}/reject-broadcaster`)
      .set('Cookie', broadcasterAuth.cookieHeader)
      .set('X-CSRF-Token', broadcasterAuth.csrfHeader)
      .send({ reason: 'Motivo valido para rejeicao do pedido' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/não pode ser recusado/i);
  });

  it('should reject non-broadcaster users', async () => {
    const { advertiserAuth, order } = await createTestOrder({ status: 'paid' });

    const res = await request(app)
      .post(`/api/campaigns/${order._id}/reject-broadcaster`)
      .set('Cookie', advertiserAuth.cookieHeader)
      .set('X-CSRF-Token', advertiserAuth.csrfHeader)
      .send({ reason: 'Motivo valido para rejeicao do pedido' });

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────
// GET /api/campaigns/:orderId
// ─────────────────────────────────────────────────
describe('GET /api/campaigns/:orderId', () => {
  it('should return campaign details for the buyer', async () => {
    const { advertiserAuth, order } = await createTestOrder();

    const res = await request(app)
      .get(`/api/campaigns/${order._id}`)
      .set('Cookie', advertiserAuth.cookieHeader)
      .set('X-CSRF-Token', advertiserAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.campaign).toBeDefined();
    expect(res.body.campaign.broadcasters).toBeDefined();
    expect(res.body.campaign.broadcasters.length).toBeGreaterThanOrEqual(1);
  });

  it('should return campaign details for the broadcaster', async () => {
    const { broadcasterAuth, order } = await createTestOrder();

    const res = await request(app)
      .get(`/api/campaigns/${order._id}`)
      .set('Cookie', broadcasterAuth.cookieHeader)
      .set('X-CSRF-Token', broadcasterAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.campaign).toBeDefined();
  });

  it('should return campaign details for admin', async () => {
    const { order } = await createTestOrder();
    const { auth: adminAuth } = await createAdmin();

    const res = await request(app)
      .get(`/api/campaigns/${order._id}`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.campaign).toBeDefined();
  });

  it('should return 403 for unrelated user', async () => {
    const { order } = await createTestOrder();
    const { auth: otherAuth } = await createAdvertiser();

    const res = await request(app)
      .get(`/api/campaigns/${order._id}`)
      .set('Cookie', otherAuth.cookieHeader)
      .set('X-CSRF-Token', otherAuth.csrfHeader);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/permissão/i);
  });

  it('should return 404 for non-existent order', async () => {
    const { auth } = await createAdvertiser();
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .get(`/api/campaigns/${fakeId}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(404);
  });

  it('should return 401 when unauthenticated', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app).get(`/api/campaigns/${fakeId}`);
    expect(res.status).toBe(401);
  });
});
