/**
 * Integration Tests — Cart API
 *
 * Tests real HTTP endpoints end-to-end.
 * GET    /api/cart
 * POST   /api/cart/items
 * PUT    /api/cart/items/quantity
 * DELETE /api/cart/items/:id
 * DELETE /api/cart
 * POST   /api/cart/sync
 */

import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';
import mongoose from 'mongoose';

import { createTestApp } from '../helpers/createTestApp';
import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import {
  createAdvertiser,
  createBroadcaster,
} from '../helpers/authHelper';
import { Product } from '../../models/Product';
import { Cart } from '../../models/Cart';

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
 * Helper: creates an approved broadcaster + active product for cart tests.
 */
async function createBroadcasterWithProduct() {
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

  return { broadcaster, product };
}

// ─────────────────────────────────────────────────
// GET /api/cart
// ─────────────────────────────────────────────────
describe('GET /api/cart', () => {
  it('should return empty cart for new user', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .get('/api/cart')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it('should return cart with items', async () => {
    const { user: advertiser, auth } = await createAdvertiser();
    const { broadcaster, product } = await createBroadcasterWithProduct();

    // Add item directly in DB
    await Cart.create({
      userId: advertiser._id,
      items: [{
        productId: product._id,
        productName: 'Comercial 30s',
        productSchedule: 'Rotativo',
        broadcasterId: broadcaster._id,
        broadcasterName: 'Radio Test FM',
        broadcasterDial: '100.1',
        broadcasterBand: 'FM',
        broadcasterLogo: '',
        broadcasterCity: 'São Paulo',
        price: 125,
        quantity: 5,
        duration: 30,
        addedAt: new Date(),
      }],
    });

    const res = await request(app)
      .get('/api/cart')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].productName).toBe('Comercial 30s');
    expect(res.body.items[0].quantity).toBe(5);
  });

  it('should return 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/cart');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────
// POST /api/cart/items
// ─────────────────────────────────────────────────
describe('POST /api/cart/items', () => {
  it('should add item to cart', async () => {
    const { auth } = await createAdvertiser();
    const { product } = await createBroadcasterWithProduct();

    const res = await request(app)
      .post('/api/cart/items')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ productId: product._id.toString(), quantity: 3 });

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].quantity).toBe(3);
    expect(res.body.items[0].price).toBe(125);
  });

  it('should reject invalid quantity (0)', async () => {
    const { auth } = await createAdvertiser();
    const { product } = await createBroadcasterWithProduct();

    const res = await request(app)
      .post('/api/cart/items')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ productId: product._id.toString(), quantity: 0 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/inválidos/i);
  });

  it('should reject when productId is missing', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .post('/api/cart/items')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ quantity: 1 });

    expect(res.status).toBe(400);
  });

  it('should return 404 for non-existent product', async () => {
    const { auth } = await createAdvertiser();
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .post('/api/cart/items')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ productId: fakeId.toString(), quantity: 1 });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/não encontrado|indisponível/i);
  });

  it('should update quantity when adding same product again', async () => {
    const { auth } = await createAdvertiser();
    const { product } = await createBroadcasterWithProduct();
    const productId = product._id.toString();

    // Add first time
    await request(app)
      .post('/api/cart/items')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ productId, quantity: 2 });

    // Add same product again with different quantity
    const res = await request(app)
      .post('/api/cart/items')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ productId, quantity: 7 });

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].quantity).toBe(7);
  });
});

// ─────────────────────────────────────────────────
// PUT /api/cart/items/quantity
// ─────────────────────────────────────────────────
describe('PUT /api/cart/items/quantity', () => {
  it('should update item quantity', async () => {
    const { user: advertiser, auth } = await createAdvertiser();
    const { broadcaster, product } = await createBroadcasterWithProduct();

    // Create cart with item
    await Cart.create({
      userId: advertiser._id,
      items: [{
        productId: product._id,
        productName: 'Comercial 30s',
        productSchedule: 'Rotativo',
        broadcasterId: broadcaster._id,
        broadcasterName: 'Radio Test FM',
        broadcasterDial: '100.1',
        broadcasterBand: 'FM',
        broadcasterLogo: '',
        broadcasterCity: 'São Paulo',
        price: 125,
        quantity: 2,
        duration: 30,
        addedAt: new Date(),
      }],
    });

    const res = await request(app)
      .put('/api/cart/items/quantity')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ productId: product._id.toString(), quantity: 10 });

    expect(res.status).toBe(200);
    expect(res.body.items[0].quantity).toBe(10);
  });

  it('should return 404 for item not in cart', async () => {
    const { user: advertiser, auth } = await createAdvertiser();
    const fakeProductId = new mongoose.Types.ObjectId();

    // Create empty cart
    await Cart.create({ userId: advertiser._id, items: [] });

    const res = await request(app)
      .put('/api/cart/items/quantity')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ productId: fakeProductId.toString(), quantity: 5 });

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────
// DELETE /api/cart/items/:productId
// ─────────────────────────────────────────────────
describe('DELETE /api/cart/items/:productId', () => {
  it('should remove item from cart', async () => {
    const { user: advertiser, auth } = await createAdvertiser();
    const { broadcaster, product } = await createBroadcasterWithProduct();

    await Cart.create({
      userId: advertiser._id,
      items: [{
        productId: product._id,
        productName: 'Comercial 30s',
        productSchedule: 'Rotativo',
        broadcasterId: broadcaster._id,
        broadcasterName: 'Radio Test FM',
        broadcasterDial: '100.1',
        broadcasterBand: 'FM',
        broadcasterLogo: '',
        broadcasterCity: 'São Paulo',
        price: 125,
        quantity: 2,
        duration: 30,
        addedAt: new Date(),
      }],
    });

    const res = await request(app)
      .delete(`/api/cart/items/${product._id.toString()}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────
// DELETE /api/cart
// ─────────────────────────────────────────────────
describe('DELETE /api/cart', () => {
  it('should clear entire cart', async () => {
    const { user: advertiser, auth } = await createAdvertiser();
    const { broadcaster, product } = await createBroadcasterWithProduct();

    await Cart.create({
      userId: advertiser._id,
      items: [{
        productId: product._id,
        productName: 'Comercial 30s',
        productSchedule: 'Rotativo',
        broadcasterId: broadcaster._id,
        broadcasterName: 'Radio Test FM',
        broadcasterDial: '100.1',
        broadcasterBand: 'FM',
        broadcasterLogo: '',
        broadcasterCity: 'São Paulo',
        price: 125,
        quantity: 5,
        duration: 30,
        addedAt: new Date(),
      }],
    });

    const res = await request(app)
      .delete('/api/cart')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────
// POST /api/cart/sync
// ─────────────────────────────────────────────────
describe('POST /api/cart/sync', () => {
  it('should sync cart from localStorage data', async () => {
    const { auth } = await createAdvertiser();
    const { product } = await createBroadcasterWithProduct();

    const res = await request(app)
      .post('/api/cart/sync')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        items: [
          { productId: product._id.toString(), quantity: 4 },
        ],
      });

    expect(res.status).toBe(200);
    // Product is validated against DB — quantity should be present
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].quantity).toBe(4);
  });

  it('should discard items with non-existent products', async () => {
    const { auth } = await createAdvertiser();
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .post('/api/cart/sync')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        items: [
          { productId: fakeId.toString(), quantity: 2 },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
  });

  it('should reject when items is not an array', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .post('/api/cart/sync')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ items: 'not-an-array' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/inválidos/i);
  });
});
