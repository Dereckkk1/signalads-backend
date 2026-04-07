/**
 * Integration Tests — Directory Report API (Admin)
 *
 * Tests real HTTP endpoints end-to-end.
 * GET /api/admin/directory-report               (admin)
 * GET /api/admin/directory-report/spot-types     (admin)
 * GET /api/admin/directory-report/no-products    (admin)
 * PUT /api/admin/directory-report/:productId     (admin)
 * PUT /api/admin/directory-report/broadcaster/:broadcasterId/pmm (admin)
 */

import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';

import { createTestApp } from '../helpers/createTestApp';
import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import {
  createAdmin,
  createBroadcaster,
  createAdvertiser,
} from '../helpers/authHelper';
import { Product } from '../../models/Product';
import { User } from '../../models/User';

let app: Application;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret-key-for-testing-12345';
  process.env.NODE_ENV = 'test';
  await connectTestDB();
  app = createTestApp(); // adminRoutes is already in createTestApp
});

afterEach(async () => {
  await clearTestDB();
});

afterAll(async () => {
  await disconnectTestDB();
});

/** Helper: creates a broadcaster with products */
async function createBroadcasterWithProducts() {
  const { user: broadcaster } = await createBroadcaster();

  const product30 = await Product.create({
    broadcasterId: broadcaster._id,
    spotType: 'Comercial 30s',
    duration: 30,
    timeSlot: 'Rotativo',
    netPrice: 100,
    pricePerInsertion: 125,
    isActive: true,
  });

  const product15 = await Product.create({
    broadcasterId: broadcaster._id,
    spotType: 'Comercial 15s',
    duration: 15,
    timeSlot: 'Rotativo',
    netPrice: 75,
    pricePerInsertion: 93.75,
    isActive: true,
  });

  return { broadcaster, product30, product15 };
}

// ─────────────────────────────────────────────────
// GET /api/admin/directory-report/spot-types
// ─────────────────────────────────────────────────
describe('GET /api/admin/directory-report/spot-types', () => {
  it('should return distinct spot types', async () => {
    await createBroadcasterWithProducts();

    const { auth } = await createAdmin();

    const res = await request(app)
      .get('/api/admin/directory-report/spot-types')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toContain('Comercial 30s');
    expect(res.body).toContain('Comercial 15s');
  });

  it('should return 403 for non-admin', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .get('/api/admin/directory-report/spot-types')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────
// GET /api/admin/directory-report
// ─────────────────────────────────────────────────
describe('GET /api/admin/directory-report', () => {
  it('should return formatted report data', async () => {
    await createBroadcasterWithProducts();

    const { auth } = await createAdmin();

    const res = await request(app)
      .get('/api/admin/directory-report')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.items).toBeDefined();
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.total).toBeDefined();
    expect(res.body.page).toBe(1);

    if (res.body.items.length > 0) {
      const item = res.body.items[0];
      expect(item.emissora).toBeDefined();
      expect(item.produto).toBeDefined();
      expect(item.precoPlataforma).toBeDefined();
    }
  });

  it('should return empty items when no broadcasters with products exist', async () => {
    const { auth } = await createAdmin();

    const res = await request(app)
      .get('/api/admin/directory-report')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
    expect(res.body.total).toBe(0);
  });

  it('should return 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/admin/directory-report');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────
// GET /api/admin/directory-report/no-products
// ─────────────────────────────────────────────────
describe('GET /api/admin/directory-report/no-products', () => {
  it('should return broadcasters with no active products', async () => {
    // Create a broadcaster WITHOUT any products
    await createBroadcaster();

    const { auth } = await createAdmin();

    const res = await request(app)
      .get('/api/admin/directory-report/no-products')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.items).toBeDefined();
    // At least the broadcaster we created should appear
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);
    expect(res.body.items[0].noProducts).toBe(true);
  });

  it('should NOT include broadcasters that have active products', async () => {
    await createBroadcasterWithProducts();

    const { auth } = await createAdmin();

    const res = await request(app)
      .get('/api/admin/directory-report/no-products')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    // The broadcaster with products should not be in the no-products list
    expect(res.body.items).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────
// PUT /api/admin/directory-report/:productId
// ─────────────────────────────────────────────────
describe('PUT /api/admin/directory-report/:productId', () => {
  it('should update price of 30s product', async () => {
    const { product30 } = await createBroadcasterWithProducts();

    const { auth } = await createAdmin();

    const res = await request(app)
      .put(`/api/admin/directory-report/${product30._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ precoPlataforma: 200 });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/atualizado/i);

    // Verify price was updated
    const updated = await Product.findById(product30._id);
    expect(updated!.pricePerInsertion).toBe(200);
    expect(updated!.manuallyEdited).toBe(true);
  });

  it('should reject editing non-30s product', async () => {
    const { product15 } = await createBroadcasterWithProducts();

    const { auth } = await createAdmin();

    const res = await request(app)
      .put(`/api/admin/directory-report/${product15._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ precoPlataforma: 150 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/30s/i);
  });

  it('should update PMM in broadcaster profile', async () => {
    const { broadcaster, product30 } = await createBroadcasterWithProducts();

    const { auth } = await createAdmin();

    const res = await request(app)
      .put(`/api/admin/directory-report/${product30._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ pmm: 50000 });

    expect(res.status).toBe(200);

    const updated = await User.findById(broadcaster._id);
    expect(updated!.broadcasterProfile!.pmm).toBe(50000);
  });
});

// ─────────────────────────────────────────────────
// PUT /api/admin/directory-report/broadcaster/:broadcasterId/pmm
// ─────────────────────────────────────────────────
describe('PUT /api/admin/directory-report/broadcaster/:broadcasterId/pmm', () => {
  it('should update broadcaster PMM directly', async () => {
    const { user: broadcaster } = await createBroadcaster();

    const { auth } = await createAdmin();

    const res = await request(app)
      .put(`/api/admin/directory-report/broadcaster/${broadcaster._id}/pmm`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ pmm: 75000 });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/PMM/i);

    const updated = await User.findById(broadcaster._id);
    expect(updated!.broadcasterProfile!.pmm).toBe(75000);
  });

  it('should return 404 for non-existent broadcaster', async () => {
    const { auth } = await createAdmin();
    const fakeId = '000000000000000000000000';

    const res = await request(app)
      .put(`/api/admin/directory-report/broadcaster/${fakeId}/pmm`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ pmm: 1000 });

    expect(res.status).toBe(404);
  });
});
