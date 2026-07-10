/**
 * Integration Tests — GET /api/admin/orders/attention-count
 * Fonte única para o badge de pedidos pendentes.
 */

import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';

import { createTestApp } from '../helpers/createTestApp';
import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { createAdmin, createAdvertiser } from '../helpers/authHelper';
import Order from '../../models/Order';

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

const makeOrder = (buyerId: string, status: string, n: number) => ({
  orderNumber: `ORD-20260710-000${n}`,
  buyerId,
  buyerName: 'Comprador Teste',
  buyerEmail: 'comprador@teste.com',
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

describe('GET /api/admin/orders/attention-count', () => {
  it('conta apenas os status de atenção', async () => {
    const admin = await createAdmin();
    const { user: buyer } = await createAdvertiser();
    await Order.create(makeOrder(buyer._id, 'pending_payment', 1));
    await Order.create(makeOrder(buyer._id, 'paid', 2));
    await Order.create(makeOrder(buyer._id, 'completed', 3)); // não conta
    await Order.create(makeOrder(buyer._id, 'cancelled', 4)); // não conta

    const res = await request(app)
      .get('/api/admin/orders/attention-count')
      .set('Cookie', admin.auth.cookieHeader);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 2 });
  });

  it('retorna 401 sem autenticação', async () => {
    const res = await request(app).get('/api/admin/orders/attention-count');
    expect(res.status).toBe(401);
  });

  it('retorna 403 para não-admin', async () => {
    const adv = await createAdvertiser();
    const res = await request(app)
      .get('/api/admin/orders/attention-count')
      .set('Cookie', adv.auth.cookieHeader);
    expect(res.status).toBe(403);
  });
});
