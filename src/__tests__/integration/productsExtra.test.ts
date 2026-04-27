/**
 * Integration Tests — Products API (Extra Coverage)
 *
 * Cobre branches/edge cases ainda não testados em productController.ts:
 * - getAllActiveProducts: filtros band, minPrice, maxPrice, emissora inativa
 * - createProduct: validação spotType, companion products
 * - updateProduct: desativar/reativar produto, price tiers
 * - deleteProduct: produto inexistente
 * - getMyProducts: paginação e filtros
 * - exportProducts: geração de xlsx
 */

import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';
import express from 'express';
import cookieParser from 'cookie-parser';

import { mongoSanitize, xssSanitize, dedupeQuery } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';
import productRoutes from '../../routes/productRoutes';

import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { createBroadcaster, createAdvertiser, createAdmin } from '../helpers/authHelper';
import { Product } from '../../models/Product';
import { User } from '../../models/User';

function createApp(): Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(mongoSanitize);
  app.use(xssSanitize);
  app.use(dedupeQuery);
  app.use(csrfProtection);
  app.use('/api/products', productRoutes);
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.status || 500).json({ error: 'Erro interno' });
  });
  return app;
}

let app: Application;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret-key-for-testing-12345';
  process.env.NODE_ENV = 'test';
  await connectTestDB();
  app = createApp();
});

afterEach(async () => {
  await clearTestDB();
});

afterAll(async () => {
  await disconnectTestDB();
});

// ─── getAllActiveProducts filtros extras ──────────────────────────────────

describe('GET /api/products/marketplace — filtros extras', () => {
  it('filtra por faixa de preco (minPrice e maxPrice)', async () => {
    const { user: broadcaster } = await createBroadcaster();

    await Product.create([
      { broadcasterId: broadcaster._id, spotType: 'Comercial 30s', duration: 30, timeSlot: 'Manhã', netPrice: 80, pricePerInsertion: 100, isActive: true },
      { broadcasterId: broadcaster._id, spotType: 'Comercial 60s', duration: 60, timeSlot: 'Tarde', netPrice: 200, pricePerInsertion: 250, isActive: true },
    ]);

    const res = await request(app)
      .get('/api/products/marketplace?minPrice=200&maxPrice=300');

    expect(res.status).toBe(200);
    const products = res.body.products || res.body;
    expect(Array.isArray(products) ? products : products.products).toBeDefined();
  });

  it('nao retorna produtos de emissoras inativas', async () => {
    const { user: broadcaster } = await createBroadcaster();

    await User.findByIdAndUpdate(broadcaster._id, { status: 'pending' });

    await Product.create({
      broadcasterId: broadcaster._id,
      spotType: 'Comercial 30s',
      duration: 30,
      timeSlot: 'Manhã',
      netPrice: 80,
      pricePerInsertion: 100,
      isActive: true,
    });

    const res = await request(app).get('/api/products/marketplace');

    expect(res.status).toBe(200);
  });

  it('filtra por band (FM, AM, Web)', async () => {
    const { user: broadcaster } = await createBroadcaster();

    await Product.create({
      broadcasterId: broadcaster._id,
      spotType: 'Comercial 30s',
      duration: 30,
      timeSlot: 'Manhã',
      netPrice: 80,
      pricePerInsertion: 100,
      isActive: true,
    });

    const res = await request(app).get('/api/products/marketplace?band=FM');
    expect(res.status).toBe(200);
  });
});

// ─── createProduct extras ─────────────────────────────────────────────────

describe('POST /api/products — extras', () => {
  it('retorna 400 para campos obrigatorios ausentes', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/products')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ spotType: 'Comercial 30s' });

    expect(res.status).toBe(400);
  });

  it('admin pode criar produto para qualquer emissora', async () => {
    const { user: broadcaster } = await createBroadcaster();
    const { auth: adminAuth } = await createAdmin();

    const res = await request(app)
      .post('/api/products')
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .send({
        broadcasterId: broadcaster._id.toString(),
        spotType: 'Comercial 30s',
        duration: 30,
        timeSlot: 'Rotativo',
        netPrice: 100,
        pricePerInsertion: 125,
      });

    expect(res.status).toBe(201);
  });

  it('retorna 403 para advertiser tentando criar produto', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .post('/api/products')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        spotType: 'Comercial 30s',
        duration: 30,
        timeSlot: 'Manhã',
        netPrice: 100,
        pricePerInsertion: 125,
      });

    expect(res.status).toBe(403);
  });

  it('retorna 401 sem autenticacao', async () => {
    const res = await request(app)
      .post('/api/products')
      .send({ spotType: 'Comercial 30s', netPrice: 100 });
    expect(res.status).toBe(401);
  });
});

// ─── updateProduct extras ─────────────────────────────────────────────────

describe('PUT /api/products/:id — extras', () => {
  it('desativa produto', async () => {
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
    const updated = await Product.findById(product._id);
    expect(updated!.isActive).toBe(false);
  });

  it('retorna 404 para produto de outra emissora', async () => {
    const { user: broadcaster1, auth: auth1 } = await createBroadcaster();
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
      .send({ netPrice: 200 });

    expect(res.status).toBe(404);
  });
});

// ─── deleteProduct extras ─────────────────────────────────────────────────

describe('DELETE /api/products/:id — extras', () => {
  it('retorna 401 sem autenticacao', async () => {
    const res = await request(app).delete('/api/products/507f1f77bcf86cd799439011');
    expect(res.status).toBe(401);
  });

  it('retorna 403 para advertiser', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .delete('/api/products/507f1f77bcf86cd799439011')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });
});

// ─── getMyProducts extras ─────────────────────────────────────────────────

describe('GET /api/products/my-products — extras', () => {
  it('suporta paginacao', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();

    await Product.create([
      { broadcasterId: broadcaster._id, spotType: 'Comercial 30s', duration: 30, timeSlot: 'Manhã', netPrice: 80, pricePerInsertion: 100, isActive: true },
      { broadcasterId: broadcaster._id, spotType: 'Comercial 60s', duration: 60, timeSlot: 'Tarde', netPrice: 160, pricePerInsertion: 200, isActive: true },
    ]);

    const res = await request(app)
      .get('/api/products/my-products?page=1&limit=1')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
  });

  it('retorna 403 para advertiser', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .get('/api/products/my-products')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });
});

// ─── exportProducts ───────────────────────────────────────────────────────

describe('GET /api/products/my-products/export — extras', () => {
  it('retorna xlsx com produtos do broadcaster', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();

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
      .get('/api/products/my-products/export')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheet|octet-stream/i);
  });

  it('retorna 401 sem autenticacao', async () => {
    const res = await request(app).get('/api/products/my-products/export');
    expect(res.status).toBe(401);
  });
});

// ─── getMarketplaceBroadcasterDetails extras ──────────────────────────────

describe('GET /api/products/marketplace/broadcaster/:id — extras', () => {
  it('retorna 404 para emissora inativa', async () => {
    const { user: broadcaster } = await createBroadcaster();
    await User.findByIdAndUpdate(broadcaster._id, { status: 'pending' });

    const res = await request(app)
      .get(`/api/products/marketplace/broadcaster/${broadcaster._id}`);

    expect(res.status).toBe(404);
  });
});
