/**
 * Integration Tests — Checkout API
 *
 * Tests real HTTP endpoints end-to-end.
 * POST   /api/payment/checkout
 */

import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';
import mongoose from 'mongoose';
import express from 'express';
import cookieParser from 'cookie-parser';
import hpp from 'hpp';

import { mongoSanitize, xssSanitize } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';
import paymentRoutes from '../../routes/paymentRoutes';

import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import {
  createAdvertiser,
  createBroadcaster,
  createAgency,
  createAdmin,
} from '../helpers/authHelper';
import { Product } from '../../models/Product';
import { Cart } from '../../models/Cart';
import Order from '../../models/Order';

function createCheckoutTestApp(): Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(mongoSanitize);
  app.use(xssSanitize);
  app.use(hpp());
  app.use(csrfProtection);
  app.use('/api/payment', paymentRoutes);
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
  app = createCheckoutTestApp();
});

afterEach(async () => {
  await clearTestDB();
});

afterAll(async () => {
  await disconnectTestDB();
});

/**
 * Helper: creates a broadcaster with products and fills a cart for the buyer.
 */
async function createCartWithItems(buyerRole: 'advertiser' | 'agency' = 'advertiser') {
  const createBuyer = buyerRole === 'advertiser' ? createAdvertiser : createAgency;
  const { user: buyer, auth: buyerAuth } = await createBuyer();
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

  const cart = await Cart.create({
    userId: buyer._id,
    items: [
      {
        productId: product._id,
        productName: 'Comercial 30s',
        productSchedule: 'Rotativo',
        broadcasterId: broadcaster._id,
        broadcasterName: 'Radio Test FM',
        broadcasterDial: '100.1',
        broadcasterBand: 'FM',
        broadcasterLogo: '',
        broadcasterCity: 'Sao Paulo',
        price: 125,
        quantity: 10,
        duration: 30,
        addedAt: new Date(),
      },
    ],
  });

  return { buyer, buyerAuth, broadcaster, product, cart };
}

// ─────────────────────────────────────────────────
// POST /api/payment/checkout
// ─────────────────────────────────────────────────
describe('POST /api/payment/checkout', () => {
  it('should create an order from cart for advertiser', async () => {
    const { buyerAuth } = await createCartWithItems('advertiser');

    const res = await request(app)
      .post('/api/payment/checkout')
      .set('Cookie', buyerAuth.cookieHeader)
      .set('X-CSRF-Token', buyerAuth.csrfHeader)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.order).toBeDefined();
    expect(res.body.order.orderNumber).toMatch(/^ORD-/);
    expect(res.body.order.status).toBe('pending_contact');
    expect(res.body.order.items).toHaveLength(1);
    expect(res.body.order.totalAmount).toBeGreaterThan(0);
  });

  it('should create an order from cart for agency', async () => {
    const { buyerAuth } = await createCartWithItems('agency');

    const res = await request(app)
      .post('/api/payment/checkout')
      .set('Cookie', buyerAuth.cookieHeader)
      .set('X-CSRF-Token', buyerAuth.csrfHeader)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.order).toBeDefined();
    expect(res.body.order.status).toBe('pending_contact');
  });

  it('should clear the cart after successful checkout', async () => {
    const { buyer, buyerAuth, cart } = await createCartWithItems();

    const res = await request(app)
      .post('/api/payment/checkout')
      .set('Cookie', buyerAuth.cookieHeader)
      .set('X-CSRF-Token', buyerAuth.csrfHeader)
      .send({});

    expect(res.status).toBe(201);

    // Cart should be empty now
    const updatedCart = await Cart.findById(cart._id);
    expect(updatedCart!.items).toHaveLength(0);
  });

  it('should reject when cart is empty', async () => {
    const { user: advertiser, auth } = await createAdvertiser();

    // Create an empty cart
    await Cart.create({ userId: advertiser._id, items: [] });

    const res = await request(app)
      .post('/api/payment/checkout')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/vazio|checkout/i);
  });

  it('should reject when no cart exists', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .post('/api/payment/checkout')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/vazio|checkout/i);
  });

  it('should reject when broadcaster tries to checkout', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/payment/checkout')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/anunciantes|agências/i);
  });

  it('should reject when admin tries to checkout', async () => {
    const { auth } = await createAdmin();

    const res = await request(app)
      .post('/api/payment/checkout')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({});

    expect(res.status).toBe(403);
  });

  it('should return 401 when unauthenticated', async () => {
    const res = await request(app)
      .post('/api/payment/checkout')
      .send({});

    expect(res.status).toBe(401);
  });

  it('should prevent double checkout (atomicity)', async () => {
    const { buyerAuth } = await createCartWithItems();

    // First checkout should succeed
    const res1 = await request(app)
      .post('/api/payment/checkout')
      .set('Cookie', buyerAuth.cookieHeader)
      .set('X-CSRF-Token', buyerAuth.csrfHeader)
      .send({});

    expect(res1.status).toBe(201);

    // Second checkout should fail (cart already empty)
    const res2 = await request(app)
      .post('/api/payment/checkout')
      .set('Cookie', buyerAuth.cookieHeader)
      .set('X-CSRF-Token', buyerAuth.csrfHeader)
      .send({});

    expect(res2.status).toBe(400);
    expect(res2.body.error).toMatch(/vazio|checkout/i);
  });

  it('should calculate correct financial amounts', async () => {
    const { buyerAuth, product } = await createCartWithItems();

    const res = await request(app)
      .post('/api/payment/checkout')
      .set('Cookie', buyerAuth.cookieHeader)
      .set('X-CSRF-Token', buyerAuth.csrfHeader)
      .send({});

    expect(res.status).toBe(201);

    // Verify financial calculation in the created order
    const order = await Order.findById(res.body.order._id);
    expect(order).not.toBeNull();

    // 10 items * 125 each = 1250
    expect(order!.grossAmount).toBe(1250);
    // broadcasterAmount = 75% of grossAmount = 937.5
    expect(order!.broadcasterAmount).toBe(937.5);
    // platformSplit = 20% of grossAmount = 250
    expect(order!.platformSplit).toBe(250);
    // techFee = 5% of grossAmount = 62.5
    expect(order!.techFee).toBe(62.5);
  });

  it('should reject agency commission from non-agency user', async () => {
    const { buyerAuth } = await createCartWithItems('advertiser');

    const res = await request(app)
      .post('/api/payment/checkout')
      .set('Cookie', buyerAuth.cookieHeader)
      .set('X-CSRF-Token', buyerAuth.csrfHeader)
      .send({ agencyCommission: 10 });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/agências/i);
  });

  it('should accept agency commission from agency user', async () => {
    const { buyerAuth } = await createCartWithItems('agency');

    const res = await request(app)
      .post('/api/payment/checkout')
      .set('Cookie', buyerAuth.cookieHeader)
      .set('X-CSRF-Token', buyerAuth.csrfHeader)
      .send({ agencyCommission: 10 });

    expect(res.status).toBe(201);
    expect(res.body.order).toBeDefined();

    const order = await Order.findById(res.body.order._id);
    // agencyCommission is stored as monetary amount, not percentage
    // grossAmount = 10 items * R$125 = R$1250, commission = 1250 * (10/100) = R$125
    expect(order!.agencyCommission).toBe(125);
  });

  it('should reject agency commission above 30%', async () => {
    const { buyerAuth } = await createCartWithItems('agency');

    const res = await request(app)
      .post('/api/payment/checkout')
      .set('Cookie', buyerAuth.cookieHeader)
      .set('X-CSRF-Token', buyerAuth.csrfHeader)
      .send({ agencyCommission: 35 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/0 e 30%/i);
  });

  it('should handle monitoring cost when enabled', async () => {
    const { buyerAuth } = await createCartWithItems('advertiser');

    const res = await request(app)
      .post('/api/payment/checkout')
      .set('Cookie', buyerAuth.cookieHeader)
      .set('X-CSRF-Token', buyerAuth.csrfHeader)
      .send({ isMonitoringEnabled: true });

    expect(res.status).toBe(201);

    const order = await Order.findById(res.body.order._id);
    expect(order!.isMonitoringEnabled).toBe(true);
    // 1 broadcaster * R$70 = 70
    expect(order!.monitoringCost).toBe(70);
  });

  it('should reject checkout when product becomes unavailable', async () => {
    const { buyerAuth, product } = await createCartWithItems();

    // Deactivate the product after cart was created
    await Product.findByIdAndUpdate(product._id, { isActive: false });

    const res = await request(app)
      .post('/api/payment/checkout')
      .set('Cookie', buyerAuth.cookieHeader)
      .set('X-CSRF-Token', buyerAuth.csrfHeader)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/não encontrado|indisponível/i);
  });
});
