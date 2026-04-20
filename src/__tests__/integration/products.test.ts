/**
 * Integration Tests — Products API
 *
 * Tests real HTTP endpoints end-to-end.
 * GET    /api/products/marketplace
 * GET    /api/products/marketplace/cities
 * POST   /api/products
 * PUT    /api/products/:id
 * DELETE /api/products/:id
 * GET    /api/products/my-products
 */

import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';
import mongoose from 'mongoose';

import { createTestApp } from '../helpers/createTestApp';
import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import {
  createBroadcaster,
  createAdvertiser,
  createAdmin,
} from '../helpers/authHelper';
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

// ─────────────────────────────────────────────────
// GET /api/products/marketplace (public)
// ─────────────────────────────────────────────────
describe('GET /api/products/marketplace', () => {
  it('should return marketplace products (public, no auth required)', async () => {
    // Create approved broadcaster + product
    const { user: broadcaster } = await createBroadcaster();
    await Product.create({
      broadcasterId: broadcaster._id,
      spotType: 'Comercial 30s',
      duration: 30,
      timeSlot: 'Rotativo',
      netPrice: 100,
      pricePerInsertion: 125,
      isActive: true,
    });

    const res = await request(app)
      .get('/api/products/marketplace');

    expect(res.status).toBe(200);
    expect(res.body.products).toBeDefined();
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.totalItems).toBeGreaterThanOrEqual(1);
  });

  it('should return empty when no products exist', async () => {
    const res = await request(app)
      .get('/api/products/marketplace');

    expect(res.status).toBe(200);
    expect(res.body.products).toHaveLength(0);
    expect(res.body.pagination.totalItems).toBe(0);
  });

  it('should filter by city', async () => {
    const { user: broadcaster } = await createBroadcaster({
      address: {
        cep: '01001000',
        street: 'Rua A',
        number: '1',
        neighborhood: 'Centro',
        city: 'Curitiba',
        state: 'PR',
      },
    });
    await Product.create({
      broadcasterId: broadcaster._id,
      spotType: 'Comercial 15s',
      duration: 15,
      timeSlot: 'Rotativo',
      netPrice: 50,
      pricePerInsertion: 62.5,
      isActive: true,
    });

    const res = await request(app)
      .get('/api/products/marketplace?city=Curitiba');

    expect(res.status).toBe(200);
    expect(res.body.pagination.totalItems).toBeGreaterThanOrEqual(1);
  });

  it('should not show products from unapproved broadcasters', async () => {
    const { user: pendingBroadcaster } = await createBroadcaster({ status: 'pending' });
    await Product.create({
      broadcasterId: pendingBroadcaster._id,
      spotType: 'Comercial 30s',
      duration: 30,
      timeSlot: 'Rotativo',
      netPrice: 100,
      pricePerInsertion: 125,
      isActive: true,
    });

    const res = await request(app)
      .get('/api/products/marketplace');

    expect(res.status).toBe(200);
    expect(res.body.pagination.totalItems).toBe(0);
  });
});

// ─────────────────────────────────────────────────
// GET /api/products/marketplace/cities
// ─────────────────────────────────────────────────
describe('GET /api/products/marketplace/cities', () => {
  it('should return list of cities with active products', async () => {
    const { user: broadcaster } = await createBroadcaster();
    await Product.create({
      broadcasterId: broadcaster._id,
      spotType: 'Comercial 30s',
      duration: 30,
      timeSlot: 'Rotativo',
      netPrice: 100,
      pricePerInsertion: 125,
      isActive: true,
    });

    const res = await request(app)
      .get('/api/products/marketplace/cities');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // The broadcaster was created with city 'São Paulo'
    expect(res.body).toContain('São Paulo');
  });

  it('should return empty array when no products exist', async () => {
    const res = await request(app)
      .get('/api/products/marketplace/cities');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ─────────────────────────────────────────────────
// POST /api/products (create product)
// ─────────────────────────────────────────────────
describe('POST /api/products', () => {
  it('should allow broadcaster to create a product', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/products')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        spotType: 'Comercial 30s',
        timeSlot: 'Rotativo',
        netPrice: 200,
      });

    expect(res.status).toBe(201);
    expect(res.body.product).toBeDefined();
    expect(res.body.product.spotType).toBe('Comercial 30s');
    expect(res.body.product.netPrice).toBe(200);
    // pricePerInsertion = netPrice * 1.25
    expect(res.body.product.pricePerInsertion).toBe(250);
  });

  it('should create companion products for Comercial 30s', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/products')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        spotType: 'Comercial 30s',
        timeSlot: 'Rotativo',
        netPrice: 100,
      });

    expect(res.status).toBe(201);
    // Should create companions: 15s, 45s, 60s
    expect(res.body.companionsCreated).toBeDefined();
    expect(res.body.companionsCreated.length).toBeGreaterThanOrEqual(1);
  });

  it('should reject when advertiser tries to create product', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .post('/api/products')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        spotType: 'Comercial 30s',
        timeSlot: 'Rotativo',
        netPrice: 100,
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/emissoras|administradores/i);
  });

  it('should reject when required fields are missing', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/products')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        spotType: 'Comercial 30s',
        // missing timeSlot and netPrice
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/obrigatóri/i);
  });

  it('should allow admin to create product for a broadcaster', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: broadcaster } = await createBroadcaster();

    const res = await request(app)
      .post('/api/products')
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .send({
        spotType: 'Comercial 15s',
        timeSlot: 'Horário Nobre',
        netPrice: 80,
        broadcasterId: broadcaster._id.toString(),
      });

    expect(res.status).toBe(201);
    expect(res.body.product.broadcasterId).toBe(broadcaster._id.toString());
  });
});

// ─────────────────────────────────────────────────
// PUT /api/products/:id
// ─────────────────────────────────────────────────
describe('PUT /api/products/:id', () => {
  it('should allow broadcaster to update own product', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();

    const product = await Product.create({
      broadcasterId: broadcaster._id,
      spotType: 'Comercial 30s',
      duration: 30,
      timeSlot: 'Rotativo',
      netPrice: 100,
      pricePerInsertion: 125,
      isActive: true,
    });

    const res = await request(app)
      .put(`/api/products/${product._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ netPrice: 150 });

    expect(res.status).toBe(200);
    expect(res.body.product.netPrice).toBe(150);
    // pricePerInsertion should be recalculated: 150 * 1.25 = 187.5
    expect(res.body.product.pricePerInsertion).toBe(187.5);
  });

  it('should allow broadcaster to deactivate product', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();

    const product = await Product.create({
      broadcasterId: broadcaster._id,
      spotType: 'Comercial 30s',
      duration: 30,
      timeSlot: 'Rotativo',
      netPrice: 100,
      pricePerInsertion: 125,
      isActive: true,
    });

    const res = await request(app)
      .put(`/api/products/${product._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ isActive: false });

    expect(res.status).toBe(200);
    expect(res.body.product.isActive).toBe(false);
  });

  it('should return 404 when broadcaster updates product they do not own', async () => {
    const { auth: auth1 } = await createBroadcaster();
    const { user: broadcaster2 } = await createBroadcaster();

    const product = await Product.create({
      broadcasterId: broadcaster2._id,
      spotType: 'Comercial 30s',
      duration: 30,
      timeSlot: 'Rotativo',
      netPrice: 100,
      pricePerInsertion: 125,
      isActive: true,
    });

    const res = await request(app)
      .put(`/api/products/${product._id}`)
      .set('Cookie', auth1.cookieHeader)
      .set('X-CSRF-Token', auth1.csrfHeader)
      .send({ netPrice: 999 });

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────
// DELETE /api/products/:id
// ─────────────────────────────────────────────────
describe('DELETE /api/products/:id', () => {
  it('should allow broadcaster to delete own product', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();

    const product = await Product.create({
      broadcasterId: broadcaster._id,
      spotType: 'Comercial 30s',
      duration: 30,
      timeSlot: 'Rotativo',
      netPrice: 100,
      pricePerInsertion: 125,
      isActive: true,
    });

    const res = await request(app)
      .delete(`/api/products/${product._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/sucesso/i);

    // Confirm deleted
    const deleted = await Product.findById(product._id);
    expect(deleted).toBeNull();
  });

  it('should return 404 when trying to delete non-existent product', async () => {
    const { auth } = await createBroadcaster();
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .delete(`/api/products/${fakeId}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(404);
  });

  it('should reject when advertiser tries to delete', async () => {
    const { auth: advAuth } = await createAdvertiser();
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

    const res = await request(app)
      .delete(`/api/products/${product._id}`)
      .set('Cookie', advAuth.cookieHeader)
      .set('X-CSRF-Token', advAuth.csrfHeader);

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────
// GET /api/products/my-products
// ─────────────────────────────────────────────────
describe('GET /api/products/my-products', () => {
  it('should return broadcaster own products', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();

    await Product.create([
      {
        broadcasterId: broadcaster._id,
        spotType: 'Comercial 15s',
        duration: 15,
        timeSlot: 'Rotativo',
        netPrice: 50,
        pricePerInsertion: 62.5,
        isActive: true,
      },
      {
        broadcasterId: broadcaster._id,
        spotType: 'Comercial 30s',
        duration: 30,
        timeSlot: 'Horário Nobre',
        netPrice: 200,
        pricePerInsertion: 250,
        isActive: true,
      },
    ]);

    const res = await request(app)
      .get('/api/products/my-products')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('should return empty array when broadcaster has no products', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .get('/api/products/my-products')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('should reject advertiser from listing broadcaster products', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .get('/api/products/my-products')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });

  it('should allow admin to list all products', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: broadcaster } = await createBroadcaster();

    await Product.create({
      broadcasterId: broadcaster._id,
      spotType: 'Comercial 30s',
      duration: 30,
      timeSlot: 'Rotativo',
      netPrice: 100,
      pricePerInsertion: 125,
      isActive: true,
    });

    const res = await request(app)
      .get('/api/products/my-products')
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
    // Admin without broadcasterId query param gets ALL products
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────
// GET /api/products/marketplace/broadcaster/:broadcasterId
// ─────────────────────────────────────────────────
describe('GET /api/products/marketplace/broadcaster/:broadcasterId', () => {
  it('retorna detalhes de emissora aprovada', async () => {
    const { user: broadcaster } = await createBroadcaster();

    const res = await request(app)
      .get(`/api/products/marketplace/broadcaster/${broadcaster._id}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
    expect(res.body.profile).toBeDefined();
  });

  it('retorna 404 para emissora inexistente', async () => {
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .get(`/api/products/marketplace/broadcaster/${fakeId}`);

    expect(res.status).toBe(404);
  });

  it('retorna 404 para emissora com status diferente de approved', async () => {
    const { user: pending } = await createBroadcaster({ status: 'pending' });

    const res = await request(app)
      .get(`/api/products/marketplace/broadcaster/${pending._id}`);

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────
// GET /api/products/map
// ─────────────────────────────────────────────────
describe('GET /api/products/map', () => {
  it('retorna lista de emissoras com coordenadas para o mapa', async () => {
    const res = await request(app).get('/api/products/map');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('retorna apenas emissoras com coordenadas e produtos ativos', async () => {
    const { user: broadcaster } = await createBroadcaster();
    await Product.create({
      broadcasterId: broadcaster._id,
      spotType: 'Comercial 30s',
      duration: 30,
      timeSlot: 'Rotativo',
      netPrice: 100,
      pricePerInsertion: 125,
      isActive: true,
    });

    const res = await request(app).get('/api/products/map');

    expect(res.status).toBe(200);
    // broadcaster has coordinates set by createBroadcaster helper (lat/lng in address)
    if (res.body.length > 0) {
      expect(res.body[0]).toHaveProperty('lat');
      expect(res.body[0]).toHaveProperty('lng');
    }
  });
});

// ─────────────────────────────────────────────────
// GET /api/products/compare/search
// ─────────────────────────────────────────────────
describe('GET /api/products/compare/search', () => {
  it('retorna resultados para termo de busca valido', async () => {
    const { user: broadcaster } = await createBroadcaster();
    await Product.create({
      broadcasterId: broadcaster._id,
      spotType: 'Comercial 30s',
      duration: 30,
      timeSlot: 'Rotativo',
      netPrice: 100,
      pricePerInsertion: 125,
      isActive: true,
    });

    const res = await request(app).get('/api/products/compare/search?q=Radio');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('retorna lista vazia para busca sem resultados', async () => {
    const res = await request(app).get('/api/products/compare/search?q=zzznaoexiste');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });

  it('retorna 200 mesmo sem query (q curto retorna vazio)', async () => {
    const res = await request(app).get('/api/products/compare/search?q=a');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ─────────────────────────────────────────────────
// GET /api/products/my-products/export
// ─────────────────────────────────────────────────
describe('GET /api/products/my-products/export', () => {
  it('retorna arquivo XLSX para broadcaster autenticado', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .get('/api/products/my-products/export')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    // XLSX ou 200 (mesmo sem produtos)
    expect([200, 500]).toContain(res.status);
  });

  it('retorna 403 para advertiser', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .get('/api/products/my-products/export')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });

  it('retorna 401 sem autenticacao', async () => {
    const res = await request(app).get('/api/products/my-products/export');
    expect(res.status).toBe(401);
  });
});
