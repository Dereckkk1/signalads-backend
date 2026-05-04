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

// ─────────────────────────────────────────────────
// GET /api/admin/broadcasters
// ─────────────────────────────────────────────────
describe('GET /api/admin/broadcasters', () => {
  it('retorna todas as emissoras', async () => {
    const { auth: adminAuth } = await createAdmin();
    await createBroadcaster();
    await createBroadcaster();

    const res = await request(app)
      .get('/api/admin/broadcasters')
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.broadcasters).toBeDefined();
    expect(res.body.total).toBeGreaterThanOrEqual(2);
  });

  it('filtra por status', async () => {
    const { auth: adminAuth } = await createAdmin();
    await createBroadcaster({ status: 'pending' });
    await createBroadcaster({ status: 'approved' });

    const res = await request(app)
      .get('/api/admin/broadcasters?status=pending')
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
    const statuses = res.body.broadcasters.map((b: any) => b.status);
    expect(statuses.every((s: string) => s === 'pending')).toBe(true);
  });

  it('retorna 403 para advertiser', async () => {
    const { auth } = await createAdvertiser();
    const res = await request(app)
      .get('/api/admin/broadcasters')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────
// GET /api/admin/broadcasters/management
// ─────────────────────────────────────────────────
describe('GET /api/admin/broadcasters/management', () => {
  it('retorna emissoras aprovadas com paginacao', async () => {
    const { auth: adminAuth } = await createAdmin();
    await createBroadcaster();

    const res = await request(app)
      .get('/api/admin/broadcasters/management?page=1&limit=10')
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.broadcasters).toBeDefined();
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('hasMore');
  });

  it('suporta busca por nome', async () => {
    const { auth: adminAuth } = await createAdmin();
    await createBroadcaster({ companyName: 'Radio Especifica FM' });

    const res = await request(app)
      .get('/api/admin/broadcasters/management?search=Especifica')
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────
// GET /api/admin/broadcasters/:id
// ─────────────────────────────────────────────────
describe('GET /api/admin/broadcasters/:id', () => {
  it('retorna detalhes completos da emissora', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: broadcaster } = await createBroadcaster();

    const res = await request(app)
      .get(`/api/admin/broadcasters/${broadcaster._id}`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.broadcaster._id).toBe(broadcaster._id.toString());
    expect(res.body.broadcaster.password).toBeUndefined();
  });

  it('retorna 404 para ID inexistente', async () => {
    const { auth: adminAuth } = await createAdmin();
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .get(`/api/admin/broadcasters/${fakeId}`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(404);
  });

  it('retorna 400 para usuario que nao e broadcaster', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: advertiser } = await createAdvertiser();

    const res = await request(app)
      .get(`/api/admin/broadcasters/${advertiser._id}`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────
// GET /api/admin/broadcasters/:id/campaigns
// ─────────────────────────────────────────────────
describe('GET /api/admin/broadcasters/:id/campaigns', () => {
  it('retorna campanhas agrupadas por status', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: broadcaster } = await createBroadcaster();

    const res = await request(app)
      .get(`/api/admin/broadcasters/${broadcaster._id}/campaigns`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('active');
    expect(res.body).toHaveProperty('completed');
    expect(res.body).toHaveProperty('cancelled');
  });

  it('retorna 404 para emissora inexistente', async () => {
    const { auth: adminAuth } = await createAdmin();
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .get(`/api/admin/broadcasters/${fakeId}/campaigns`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────
// GET /api/admin/users/:userId
// ─────────────────────────────────────────────────
describe('GET /api/admin/users/:userId', () => {
  it('retorna detalhes completos do usuario com pedidos e stats', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: advertiser } = await createAdvertiser();

    const res = await request(app)
      .get(`/api/admin/users/${advertiser._id}`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.stats).toBeDefined();
    expect(res.body.orders).toBeDefined();
  });

  it('retorna 404 para usuario inexistente', async () => {
    const { auth: adminAuth } = await createAdmin();
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .get(`/api/admin/users/${fakeId}`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────
// PUT /api/admin/users/:userId/status
// ─────────────────────────────────────────────────
describe('PUT /api/admin/users/:userId/status', () => {
  it('atualiza status do usuario para rejected', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: advertiser } = await createAdvertiser();

    const res = await request(app)
      .put(`/api/admin/users/${advertiser._id}/status`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .send({ status: 'rejected' });

    expect(res.status).toBe(200);
    expect(res.body.user.status).toBe('rejected');
  });

  it('retorna 400 para status invalido', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: advertiser } = await createAdvertiser();

    const res = await request(app)
      .put(`/api/admin/users/${advertiser._id}/status`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .send({ status: 'banido' });

    expect(res.status).toBe(400);
  });

  it('retorna 404 para usuario inexistente', async () => {
    const { auth: adminAuth } = await createAdmin();

    const res = await request(app)
      .put(`/api/admin/users/${new mongoose.Types.ObjectId()}/status`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .send({ status: 'approved' });

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────
// PUT /api/admin/users/:userId/role
// ─────────────────────────────────────────────────
describe('PUT /api/admin/users/:userId/role', () => {
  it('altera role de advertiser para agency', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: advertiser } = await createAdvertiser();

    const res = await request(app)
      .put(`/api/admin/users/${advertiser._id}/role`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .send({ role: 'agency' });

    expect(res.status).toBe(200);
    expect(res.body.user.userType).toBe('agency');
  });

  it('retorna 400 para role invalido', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: advertiser } = await createAdvertiser();

    const res = await request(app)
      .put(`/api/admin/users/${advertiser._id}/role`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .send({ role: 'superuser' });

    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────
// PUT /api/admin/users/:userId/reset-password
// ─────────────────────────────────────────────────
describe('PUT /api/admin/users/:userId/reset-password', () => {
  it('redefine senha do usuario', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: advertiser } = await createAdvertiser();

    const res = await request(app)
      .put(`/api/admin/users/${advertiser._id}/reset-password`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .send({ newPassword: 'NovaSenha123!@#' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/sucesso/i);
  });

  it('retorna 400 para senha fraca', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: advertiser } = await createAdvertiser();

    const res = await request(app)
      .put(`/api/admin/users/${advertiser._id}/reset-password`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .send({ newPassword: 'fraca' });

    expect(res.status).toBe(400);
  });

  it('retorna 404 para usuario inexistente', async () => {
    const { auth: adminAuth } = await createAdmin();

    const res = await request(app)
      .put(`/api/admin/users/${new mongoose.Types.ObjectId()}/reset-password`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .send({ newPassword: 'NovaSenha123!@#' });

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────
// DELETE /api/admin/users/:userId
// ─────────────────────────────────────────────────
describe('DELETE /api/admin/users/:userId', () => {
  it('exclui usuario e retorna summary', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: advertiser } = await createAdvertiser();

    const res = await request(app)
      .delete(`/api/admin/users/${advertiser._id}`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.deletedUser).toBeDefined();
    expect(res.body.summary).toBeDefined();

    const still = await User.findById(advertiser._id);
    expect(still).toBeNull();
  });

  it('retorna 403 ao tentar deletar admin', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: outroAdmin } = await createAdmin();

    const res = await request(app)
      .delete(`/api/admin/users/${outroAdmin._id}`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(403);
  });

  it('retorna 404 para usuario inexistente', async () => {
    const { auth: adminAuth } = await createAdmin();

    const res = await request(app)
      .delete(`/api/admin/users/${new mongoose.Types.ObjectId()}`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────
// PUT /api/admin/users/:userId/max-sub-users
// Admin define limite custom de sub-usuarios para uma emissora
// ─────────────────────────────────────────────────
describe('PUT /api/admin/users/:userId/max-sub-users', () => {
  it('admin define maxSubUsers customizado para emissora', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: broadcaster } = await createBroadcaster();

    const res = await request(app)
      .put(`/api/admin/users/${broadcaster._id}/max-sub-users`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .send({ maxSubUsers: 10 });

    expect(res.status).toBe(200);
    expect(res.body.user.maxSubUsers).toBe(10);

    const updated = await User.findById(broadcaster._id);
    expect(updated?.maxSubUsers).toBe(10);
  });

  it('admin remove limite customizado passando null', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: broadcaster } = await createBroadcaster();
    await User.findByIdAndUpdate(broadcaster._id, { maxSubUsers: 5 });

    const res = await request(app)
      .put(`/api/admin/users/${broadcaster._id}/max-sub-users`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .send({ maxSubUsers: null });

    expect(res.status).toBe(200);
    expect(res.body.user.maxSubUsers).toBeNull();

    const updated = await User.findById(broadcaster._id);
    expect(updated?.maxSubUsers).toBeUndefined();
  });

  it('rejeita maxSubUsers negativo (400)', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: broadcaster } = await createBroadcaster();

    const res = await request(app)
      .put(`/api/admin/users/${broadcaster._id}/max-sub-users`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .send({ maxSubUsers: -1 });

    expect(res.status).toBe(400);
  });

  it('rejeita maxSubUsers nao inteiro (400)', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: broadcaster } = await createBroadcaster();

    const res = await request(app)
      .put(`/api/admin/users/${broadcaster._id}/max-sub-users`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .send({ maxSubUsers: 'abc' });

    expect(res.status).toBe(400);
  });

  it('rejeita aplicar a usuario que nao e broadcaster manager (400)', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: advertiser } = await createAdvertiser();

    const res = await request(app)
      .put(`/api/admin/users/${advertiser._id}/max-sub-users`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .send({ maxSubUsers: 5 });

    expect(res.status).toBe(400);
  });

  it('rejeita aplicar a sub-usuario sales (400)', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: manager } = await createBroadcaster();

    const subUser = await User.create({
      name: 'Vendedor Sub',
      email: `sub-max-${Date.now()}@emissora.com.br`,
      password: 'hashedpassword12',
      phone: '11999999999',
      cpfOrCnpj: '12345678901234',
      userType: 'broadcaster',
      broadcasterRole: 'sales',
      parentBroadcasterId: manager._id,
      status: 'approved',
      emailConfirmed: true,
    });

    const res = await request(app)
      .put(`/api/admin/users/${subUser._id}/max-sub-users`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .send({ maxSubUsers: 5 });

    expect(res.status).toBe(400);
  });

  it('retorna 404 para usuario inexistente', async () => {
    const { auth: adminAuth } = await createAdmin();

    const res = await request(app)
      .put(`/api/admin/users/${new mongoose.Types.ObjectId()}/max-sub-users`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .send({ maxSubUsers: 5 });

    expect(res.status).toBe(404);
  });

  it('retorna 403 para nao-admin', async () => {
    const { auth: advAuth } = await createAdvertiser();
    const { user: broadcaster } = await createBroadcaster();

    const res = await request(app)
      .put(`/api/admin/users/${broadcaster._id}/max-sub-users`)
      .set('Cookie', advAuth.cookieHeader)
      .set('X-CSRF-Token', advAuth.csrfHeader)
      .send({ maxSubUsers: 5 });

    expect(res.status).toBe(403);
  });
});
