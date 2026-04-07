/**
 * Integration Tests — Admin API
 *
 * Tests real HTTP endpoints end-to-end.
 * GET /api/admin/broadcasters/pending
 * PUT /api/admin/broadcasters/:id/approve
 * PUT /api/admin/broadcasters/:id/reject
 * GET /api/admin/orders/full
 * PUT /api/admin/orders/:id/status
 * GET /api/admin/users
 * Authorization: non-admin gets 403
 */

import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';
import mongoose from 'mongoose';

import { createTestApp } from '../helpers/createTestApp';
import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import {
  createAdmin,
  createBroadcaster,
  createAdvertiser,
  createTestUser,
} from '../helpers/authHelper';
import { User } from '../../models/User';
import OrderModel from '../../models/Order';

let app: Application;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret-key-for-testing-12345';
  process.env.NODE_ENV = 'test';
  await connectTestDB();
  app = createTestApp();
});

afterEach(async () => {
  await clearTestDB();
});

afterAll(async () => {
  await disconnectTestDB();
});

/**
 * Helper: creates an order in DB for testing admin order endpoints.
 */
async function createTestOrder(buyerId: string, status = 'pending_contact') {
  return OrderModel.create({
    buyerId,
    buyerName: 'Test Buyer',
    buyerEmail: 'buyer@empresa.com.br',
    buyerPhone: '11999999999',
    buyerDocument: '12345678000100',
    items: [],
    payment: {
      method: 'pending_contact',
      status: 'pending',
      chargedAmount: 125,
      totalAmount: 125,
      walletAmountUsed: 0,
    },
    splits: [],
    status,
    grossAmount: 100,
    broadcasterAmount: 75,
    platformSplit: 20,
    techFee: 5,
    totalAmount: 125,
    subtotal: 100,
    platformFee: 25,
  });
}

// ─────────────────────────────────────────────────
// Authorization: non-admin gets 403
// ─────────────────────────────────────────────────
describe('Admin authorization', () => {
  it('should return 403 for advertiser accessing admin endpoints', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .get('/api/admin/broadcasters/pending')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/administradores/i);
  });

  it('should return 403 for broadcaster accessing admin endpoints', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .get('/api/admin/users')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });

  it('should return 401 when not authenticated', async () => {
    const res = await request(app)
      .get('/api/admin/broadcasters/pending');

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────
// GET /api/admin/broadcasters/pending
// ─────────────────────────────────────────────────
describe('GET /api/admin/broadcasters/pending', () => {
  it('should return pending broadcasters', async () => {
    const { auth: adminAuth } = await createAdmin();

    // Create pending broadcasters
    await createTestUser({
      userType: 'broadcaster',
      status: 'pending',
      email: 'pending1@emissora.com.br',
      companyName: 'Pending Radio 1',
    });
    await createTestUser({
      userType: 'broadcaster',
      status: 'pending',
      email: 'pending2@emissora.com.br',
      companyName: 'Pending Radio 2',
    });

    const res = await request(app)
      .get('/api/admin/broadcasters/pending')
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.broadcasters).toHaveLength(2);
  });

  it('should return empty list when no pending broadcasters', async () => {
    const { auth: adminAuth } = await createAdmin();

    const res = await request(app)
      .get('/api/admin/broadcasters/pending')
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.broadcasters).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────
// PUT /api/admin/broadcasters/:id/approve
// ─────────────────────────────────────────────────
describe('PUT /api/admin/broadcasters/:id/approve', () => {
  it('should approve a pending broadcaster', async () => {
    const { auth: adminAuth } = await createAdmin();

    const pendingBroadcaster = await createTestUser({
      userType: 'broadcaster',
      status: 'pending',
      email: 'toapprove@emissora.com.br',
      companyName: 'Radio To Approve',
    });

    const res = await request(app)
      .put(`/api/admin/broadcasters/${pendingBroadcaster._id}/approve`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/aprovada/i);
    expect(res.body.broadcaster.status).toBe('approved');

    // Verify in DB
    const updated = await User.findById(pendingBroadcaster._id);
    expect(updated!.status).toBe('approved');
  });

  it('should return 404 for non-existent broadcaster', async () => {
    const { auth: adminAuth } = await createAdmin();
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .put(`/api/admin/broadcasters/${fakeId}/approve`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(404);
  });

  it('should return 400 if user is not a broadcaster', async () => {
    const { auth: adminAuth } = await createAdmin();
    const advertiser = await createTestUser({
      userType: 'advertiser',
      email: 'notbroadcaster@empresa.com.br',
    });

    const res = await request(app)
      .put(`/api/admin/broadcasters/${advertiser._id}/approve`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/emissora/i);
  });
});

// ─────────────────────────────────────────────────
// PUT /api/admin/broadcasters/:id/reject
// ─────────────────────────────────────────────────
describe('PUT /api/admin/broadcasters/:id/reject', () => {
  it('should reject a broadcaster with reason', async () => {
    const { auth: adminAuth } = await createAdmin();

    const pendingBroadcaster = await createTestUser({
      userType: 'broadcaster',
      status: 'pending',
      email: 'toreject@emissora.com.br',
      companyName: 'Radio To Reject',
    });

    const res = await request(app)
      .put(`/api/admin/broadcasters/${pendingBroadcaster._id}/reject`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .send({ reason: 'Documentação incompleta' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/reprovada/i);
    expect(res.body.broadcaster.status).toBe('rejected');
    expect(res.body.broadcaster.rejectionReason).toBe('Documentação incompleta');
  });

  it('should reject with default reason when none provided', async () => {
    const { auth: adminAuth } = await createAdmin();

    const pendingBroadcaster = await createTestUser({
      userType: 'broadcaster',
      status: 'pending',
      email: 'toreject2@emissora.com.br',
    });

    const res = await request(app)
      .put(`/api/admin/broadcasters/${pendingBroadcaster._id}/reject`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.broadcaster.rejectionReason).toBeDefined();
  });
});

// ─────────────────────────────────────────────────
// GET /api/admin/orders/full
// ─────────────────────────────────────────────────
describe('GET /api/admin/orders/full', () => {
  it('should return all orders for admin', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: advertiser } = await createAdvertiser();

    await createTestOrder(advertiser._id.toString());
    await createTestOrder(advertiser._id.toString(), 'paid');

    const res = await request(app)
      .get('/api/admin/orders/full')
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.orders).toBeDefined();
    expect(res.body.total).toBe(2);
  });

  it('should filter orders by status', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: advertiser } = await createAdvertiser();

    await createTestOrder(advertiser._id.toString(), 'pending_contact');
    await createTestOrder(advertiser._id.toString(), 'paid');

    const res = await request(app)
      .get('/api/admin/orders/full?status=paid')
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
  });

  it('should support pagination', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: advertiser } = await createAdvertiser();

    // Create 3 orders
    await createTestOrder(advertiser._id.toString());
    await createTestOrder(advertiser._id.toString());
    await createTestOrder(advertiser._id.toString());

    const res = await request(app)
      .get('/api/admin/orders/full?page=1&limit=2')
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.orders.length).toBeLessThanOrEqual(2);
    expect(res.body.total).toBe(3);
  });
});

// ─────────────────────────────────────────────────
// PUT /api/admin/orders/:id/status
// ─────────────────────────────────────────────────
describe('PUT /api/admin/orders/:id/status', () => {
  it('should update order status (pending_contact -> pending_payment)', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: advertiser } = await createAdvertiser();
    const order = await createTestOrder(advertiser._id.toString(), 'pending_contact');

    const res = await request(app)
      .put(`/api/admin/orders/${order._id}/status`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .send({ status: 'pending_payment' });

    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe('pending_payment');
  });

  it('should update order status (pending_payment -> paid)', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: advertiser } = await createAdvertiser();
    const order = await createTestOrder(advertiser._id.toString(), 'pending_payment');

    const res = await request(app)
      .put(`/api/admin/orders/${order._id}/status`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .send({ status: 'paid' });

    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe('paid');
    expect(res.body.order.payment.status).toBe('received');
  });

  it('should cancel order with reason', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: advertiser } = await createAdvertiser();
    const order = await createTestOrder(advertiser._id.toString(), 'pending_contact');

    const res = await request(app)
      .put(`/api/admin/orders/${order._id}/status`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .send({ status: 'cancelled', cancellationReason: 'Desistência do cliente' });

    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe('cancelled');
  });

  it('should reject invalid status transition', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: advertiser } = await createAdvertiser();
    const order = await createTestOrder(advertiser._id.toString(), 'cancelled');

    const res = await request(app)
      .put(`/api/admin/orders/${order._id}/status`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .send({ status: 'paid' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/transição inválida/i);
  });

  it('should reject invalid status value', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: advertiser } = await createAdvertiser();
    const order = await createTestOrder(advertiser._id.toString());

    const res = await request(app)
      .put(`/api/admin/orders/${order._id}/status`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .send({ status: 'invalid_status' });

    expect(res.status).toBe(400);
  });

  it('should return 404 for non-existent order', async () => {
    const { auth: adminAuth } = await createAdmin();
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .put(`/api/admin/orders/${fakeId}/status`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .send({ status: 'paid' });

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────
// GET /api/admin/users
// ─────────────────────────────────────────────────
describe('GET /api/admin/users', () => {
  it('should return all users (emailConfirmed only)', async () => {
    const { auth: adminAuth } = await createAdmin();

    // Create users with emailConfirmed=true (the helper sets this by default)
    await createTestUser({
      email: 'user1@empresa.com.br',
      userType: 'advertiser',
      emailConfirmed: true,
    });
    await createTestUser({
      email: 'user2@empresa.com.br',
      userType: 'broadcaster',
      emailConfirmed: true,
    });
    // Unconfirmed user should not appear
    await createTestUser({
      email: 'unconfirmed@empresa.com.br',
      userType: 'advertiser',
      emailConfirmed: false,
    });

    const res = await request(app)
      .get('/api/admin/users')
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.users).toBeDefined();
    // admin (1) + user1 + user2 = 3; unconfirmed excluded
    expect(res.body.total).toBe(3);
  });

  it('should filter users by type', async () => {
    const { auth: adminAuth } = await createAdmin();

    await createTestUser({ email: 'adv@empresa.com.br', userType: 'advertiser' });
    await createTestUser({ email: 'bc@emissora.com.br', userType: 'broadcaster' });

    const res = await request(app)
      .get('/api/admin/users?type=advertiser')
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
    const userTypes = res.body.users.map((u: any) => u.userType);
    expect(userTypes.every((t: string) => t === 'advertiser')).toBe(true);
  });

  it('should support search', async () => {
    const { auth: adminAuth } = await createAdmin();

    await createTestUser({
      email: 'searchme@empresa.com.br',
      companyName: 'Empresa Buscavel',
    });

    const res = await request(app)
      .get('/api/admin/users?search=Buscavel')
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(res.body.users[0].companyName).toBe('Empresa Buscavel');
  });
});
