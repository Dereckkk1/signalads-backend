/**
 * Integration Tests — Repetir campanha
 * GET  /api/campaigns/last-completed
 * POST /api/cart/repeat/:orderId
 */

import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';

import { createTestApp } from '../helpers/createTestApp';
import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { createAdvertiser, createBroadcaster } from '../helpers/authHelper';
import Order from '../../models/Order';
import { Product } from '../../models/Product';

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

async function seedCompletedOrder(buyer: any) {
  const b = await createBroadcaster();
  const prod = await Product.create({
    broadcasterId: b.user._id,
    spotType: 'Comercial 30s',
    duration: 30,
    timeSlot: '06:00-12:00',
    netPrice: 100,
    pricePerInsertion: 125, // netPrice * 1.25
    isActive: true,
  });
  return Order.create({
    orderNumber: 'ORD-20260312-0002',
    buyerId: buyer.user._id,
    buyerName: 'B',
    buyerEmail: 'b@b.com',
    buyerPhone: '11999999999',
    buyerDocument: '12345678000100',
    items: [{
      productId: String(prod._id),
      productName: 'Comercial 30s',
      broadcasterId: String(b.user._id),
      broadcasterName: '89 FM',
      quantity: 22,
      unitPrice: 125,
      totalPrice: 2750,
      schedule: { '2026-03-12': 22 },
    }],
    payment: { method: 'pending_contact', status: 'pending', chargedAmount: 3437, totalAmount: 3437, walletAmountUsed: 0 },
    splits: [],
    status: 'completed',
    grossAmount: 2750,
    broadcasterAmount: 2062,
    platformSplit: 550,
    techFee: 5,
    totalAmount: 3437,
    subtotal: 2750,
    platformFee: 687,
  } as any);
}

describe('repetir campanha', () => {
  it('GET last-completed devolve resumo do último pedido concluído', async () => {
    const adv = await createAdvertiser();
    await seedCompletedOrder(adv);
    const res = await request(app).get('/api/campaigns/last-completed').set('Cookie', adv.auth.cookieHeader);
    expect(res.status).toBe(200);
    expect(res.body.order.orderNumber).toBe('ORD-20260312-0002');
    expect(res.body.order.insertionsCount).toBe(22);
    expect(res.body.order.stationNames).toContain('89 FM');
  });

  it('GET last-completed devolve null sem pedidos', async () => {
    const adv = await createAdvertiser();
    const res = await request(app).get('/api/campaigns/last-completed').set('Cookie', adv.auth.cookieHeader);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ order: null });
  });

  it('GET last-completed 401 sem autenticação', async () => {
    const res = await request(app).get('/api/campaigns/last-completed');
    expect(res.status).toBe(401);
  });

  it('POST repeat reconstrói com preço ATUAL do produto', async () => {
    const adv = await createAdvertiser();
    const order = await seedCompletedOrder(adv);
    const res = await request(app)
      .post(`/api/cart/repeat/${order._id}`)
      .set('Cookie', adv.auth.cookieHeader).set('X-CSRF-Token', adv.auth.csrfHeader);
    expect(res.status).toBe(200);
    expect(res.body.added).toBe(1);
    expect(res.body.items[0].price).toBeCloseTo(125, 2); // netPrice 100 * 1.25 atual
  });

  it('403 ao repetir pedido de outro usuário', async () => {
    const dono = await createAdvertiser();
    const intruso = await createAdvertiser();
    const order = await seedCompletedOrder(dono);
    const res = await request(app)
      .post(`/api/cart/repeat/${order._id}`)
      .set('Cookie', intruso.auth.cookieHeader).set('X-CSRF-Token', intruso.auth.csrfHeader);
    expect(res.status).toBe(403);
  });

  it('404 para pedido inexistente', async () => {
    const adv = await createAdvertiser();
    const res = await request(app)
      .post('/api/cart/repeat/64b000000000000000000000')
      .set('Cookie', adv.auth.cookieHeader).set('X-CSRF-Token', adv.auth.csrfHeader);
    expect(res.status).toBe(404);
  });
});
