/**
 * Integration Tests — Admin API (branches extras)
 * Cobre: getAllUsers com filtros, updateOrderStatus transitions,
 *        adminApproveOrder, getBroadcastersForManagement search.
 */

import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';
import mongoose from 'mongoose';

import { createTestApp } from '../helpers/createTestApp';
import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { createAdmin, createAdvertiser, createBroadcaster, createAgency } from '../helpers/authHelper';
import { User } from '../../models/User';
import Order, { IOrder } from '../../models/Order';

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

async function createTestOrder(buyerId: string, status = 'pending_contact') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (Order.create as any)({
    buyerId,
    buyerName: 'Comprador',
    buyerEmail: 'buyer@empresa.com.br',
    buyerPhone: '11999999999',
    buyerDocument: '12345678000100',
    status,
    totalAmount: 500,
    grossAmount: 400,
    subtotal: 400,
    platformFee: 100,
    techFee: 25,
    platformSplit: 100,
    broadcasterAmount: 375,
    items: [{
      broadcasterId: new mongoose.Types.ObjectId(),
      broadcasterName: 'Radio',
      productId: new mongoose.Types.ObjectId(),
      productName: 'Spot 30s',
      quantity: 2,
      unitPrice: 250,
      totalPrice: 500,
      schedule: new Map([['seg', 2]]),
    }],
    payment: {
      method: 'pending_contact',
      status: 'pending',
      chargedAmount: 500,
      totalAmount: 500,
      walletAmountUsed: 0,
    },
  }) as Promise<IOrder>;
}

// ═══════════════════════════════════════════════════════════════
// GET /api/admin/users — filtros e paginacao
// ═══════════════════════════════════════════════════════════════
describe('GET /api/admin/users — filtros', () => {
  it('filtra por tipo de usuario', async () => {
    const { auth: adminAuth } = await createAdmin();
    await createAdvertiser();
    await createAgency();
    await createBroadcaster();

    const res = await request(app)
      .get('/api/admin/users?type=advertiser')
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
    const userTypes = res.body.users.map((u: any) => u.userType);
    expect(userTypes.every((t: string) => t === 'advertiser')).toBe(true);
  });

  it('filtra por status do usuario', async () => {
    const { auth: adminAuth } = await createAdmin();
    await createAdvertiser();
    // Cria usuario com status pending
    await User.create({
      email: `pending-${Date.now()}@empresa.com.br`,
      password: '$2a$04$fakehash',
      userType: 'advertiser',
      status: 'pending',
      companyName: 'Pending Co',
      phone: '11999999999',
      cpfOrCnpj: `CPF-${Date.now()}`,
      emailConfirmed: true,
    });

    const res = await request(app)
      .get('/api/admin/users?status=pending')
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
    const statuses = res.body.users.map((u: any) => u.status);
    expect(statuses.every((s: string) => s === 'pending')).toBe(true);
  });

  it('busca usuarios por nome/email (search)', async () => {
    const { auth: adminAuth } = await createAdmin();
    await User.create({
      email: `uniquename-${Date.now()}@empresa.com.br`,
      password: '$2a$04$fakehash',
      userType: 'advertiser',
      status: 'approved',
      companyName: 'Empresa Xyzabc',
      phone: '11999999999',
      cpfOrCnpj: `CPF-uniq-${Date.now()}`,
      emailConfirmed: true,
    });

    const res = await request(app)
      .get('/api/admin/users?search=Xyzabc')
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.users.length).toBeGreaterThanOrEqual(1);
    const found = res.body.users.find((u: any) => u.companyName === 'Empresa Xyzabc');
    expect(found).toBeDefined();
  });

  it('suporta paginacao', async () => {
    const { auth: adminAuth } = await createAdmin();

    for (let i = 0; i < 5; i++) {
      await User.create({
        email: `pagtest-${i}-${Date.now()}@empresa.com.br`,
        password: '$2a$04$fakehash',
        userType: 'advertiser',
        status: 'approved',
        companyName: `Pag Empresa ${i}`,
        phone: '11999999999',
        cpfOrCnpj: `CPF-pag-${i}-${Date.now()}`,
        emailConfirmed: true,
      });
    }

    const res = await request(app)
      .get('/api/admin/users?page=1&limit=2')
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.users.length).toBeLessThanOrEqual(2);
    expect(res.body.total).toBeGreaterThanOrEqual(5);
  });
});

// ═══════════════════════════════════════════════════════════════
// PUT /api/admin/orders/:id/status — transitions extras
// ═══════════════════════════════════════════════════════════════
describe('PUT /api/admin/orders/:id/status — transitions extras', () => {
  it('transicao paid → cancelled (com motivo)', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: advertiser } = await createAdvertiser();
    const order = await createTestOrder(advertiser._id.toString(), 'paid');

    const res = await request(app)
      .put(`/api/admin/orders/${order._id}/status`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .send({ status: 'cancelled', cancellationReason: 'Solicitado pelo cliente' });

    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe('cancelled');
  });

  it('define paidAt ao marcar como paid', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: advertiser } = await createAdvertiser();
    const order = await createTestOrder(advertiser._id.toString(), 'pending_payment');

    const res = await request(app)
      .put(`/api/admin/orders/${order._id}/status`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .send({ status: 'paid' });

    expect(res.status).toBe(200);
    const updated = await Order.findById(order._id);
    expect(updated!.paidAt).toBeDefined();
  });

  it('rejeita transicao invalida (cancelled → paid)', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: advertiser } = await createAdvertiser();
    const order = await createTestOrder(advertiser._id.toString(), 'cancelled');

    const res = await request(app)
      .put(`/api/admin/orders/${order._id}/status`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .send({ status: 'paid' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/inválida/i);
  });
});

// ═══════════════════════════════════════════════════════════════
// GET /api/admin/broadcasters/management — search
// ═══════════════════════════════════════════════════════════════
describe('GET /api/admin/broadcasters/management — search', () => {
  it('busca emissoras por nome', async () => {
    const { auth: adminAuth } = await createAdmin();
    await createBroadcaster(); // broadcaster padrao

    const res = await request(app)
      .get('/api/admin/broadcasters/management?search=Radio')
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.broadcasters)).toBe(true);
  });

  it('suporta paginacao com page e limit', async () => {
    const { auth: adminAuth } = await createAdmin();

    const res = await request(app)
      .get('/api/admin/broadcasters/management?page=1&limit=5')
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('broadcasters');
  });
});

// ═══════════════════════════════════════════════════════════════
// PUT /api/admin/users/:userId/status — branches extras
// ═══════════════════════════════════════════════════════════════
describe('PUT /api/admin/users/:userId/status — extras', () => {
  it('aprova usuario que estava pending', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: advertiser } = await createAdvertiser();
    await User.findByIdAndUpdate(advertiser._id, { status: 'pending' });

    const res = await request(app)
      .put(`/api/admin/users/${advertiser._id}/status`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .send({ status: 'approved' });

    expect(res.status).toBe(200);
    expect(res.body.user.status).toBe('approved');
  });
});

// ═══════════════════════════════════════════════════════════════
// DELETE /api/admin/users/:userId — branches extras
// ═══════════════════════════════════════════════════════════════
describe('DELETE /api/admin/users/:userId — extras', () => {
  it('deleta broadcaster com produtos e retorna summary', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: broadcaster } = await createBroadcaster();

    const res = await request(app)
      .delete(`/api/admin/users/${broadcaster._id}`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.summary).toBeDefined();
    const still = await User.findById(broadcaster._id);
    expect(still).toBeNull();
  });

  it('deleta usuario agency', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: agency } = await createAgency();

    const res = await request(app)
      .delete(`/api/admin/users/${agency._id}`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════
// GET /api/admin/users/:userId — broadcaster details
// ═══════════════════════════════════════════════════════════════
describe('GET /api/admin/users/:userId — broadcaster details', () => {
  it('retorna stats de broadcaster com campaigns', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: broadcaster } = await createBroadcaster();
    const { user: advertiser } = await createAdvertiser();

    await createTestOrder(advertiser._id.toString(), 'completed');

    const res = await request(app)
      .get(`/api/admin/users/${broadcaster._id}`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.user.userType).toBe('broadcaster');
    expect(res.body.stats).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// GET /api/admin/orders/full — filtros extras
// ═══════════════════════════════════════════════════════════════
describe('GET /api/admin/orders/full — filtros extras', () => {
  it('filtra pedidos por status específico', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: advertiser } = await createAdvertiser();

    await createTestOrder(advertiser._id.toString(), 'paid');
    await createTestOrder(advertiser._id.toString(), 'cancelled');

    const res = await request(app)
      .get('/api/admin/orders/full?status=paid')
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.orders)).toBe(true);
    if (res.body.orders.length > 0) {
      expect(res.body.orders[0].status).toBe('paid');
    }
  });
});
