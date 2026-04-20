/**
 * Integration Tests — Catalog Broadcasters API (Admin)
 *
 * Tests real HTTP endpoints end-to-end.
 * POST   /api/admin/catalog-broadcasters
 * GET    /api/admin/catalog-broadcasters
 * GET    /api/admin/catalog-broadcasters/:id
 * PUT    /api/admin/catalog-broadcasters/:id
 * DELETE /api/admin/catalog-broadcasters/:id
 * POST   /api/admin/catalog-broadcasters/:id/reactivate
 * POST   /api/admin/catalog-broadcasters/:broadcasterId/products
 * GET    /api/admin/catalog-broadcasters/:broadcasterId/products
 * PUT    /api/admin/catalog-products/:productId
 * DELETE /api/admin/catalog-products/:productId
 */

import '../helpers/mocks';

// Mock node-geocoder to avoid external API calls
jest.mock('node-geocoder', () => {
  return jest.fn().mockReturnValue({
    geocode: jest.fn().mockResolvedValue([
      { latitude: -23.55, longitude: -46.63 },
    ]),
  });
});

// Mock storage uploadFile
jest.mock('../../config/storage', () => ({
  uploadFile: jest.fn().mockResolvedValue('https://storage.example.com/test-logo.png'),
}));

import request from 'supertest';
import { Application } from 'express';
import mongoose from 'mongoose';

import { createTestApp } from '../helpers/createTestApp';
import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import {
  createAdmin,
  createAdvertiser,
  createBroadcaster,
} from '../helpers/authHelper';
import { User } from '../../models/User';
import { Product } from '../../models/Product';
import OrderModel from '../../models/Order';

let app: Application;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret-key-for-testing-12345';
  process.env.NODE_ENV = 'test';
  await connectTestDB();
  // createTestApp already has adminRoutes which contains catalog broadcaster routes
  app = createTestApp();
});

afterEach(async () => {
  await clearTestDB();
});

afterAll(async () => {
  await disconnectTestDB();
});

/**
 * Helper: creates a catalog broadcaster directly in DB.
 */
async function createCatalogBroadcasterInDB(overrides: Record<string, any> = {}) {
  const broadcaster = await User.create({
    email: `catalog-${Date.now()}@emissora.com.br`,
    password: '$2a$04$fakehash',
    userType: 'broadcaster',
    status: 'approved',
    companyName: 'Radio Catalogo FM',
    fantasyName: 'Catalogo FM',
    phone: '11999998888',
    cpfOrCnpj: `CATALOG-${Date.now()}`,
    isCatalogOnly: true,
    managedByAdmin: true,
    emailConfirmed: true,
    onboardingCompleted: true,
    address: {
      city: 'Sao Paulo',
      state: 'SP',
      latitude: -23.55,
      longitude: -46.63,
    },
    broadcasterProfile: {
      generalInfo: {
        stationName: 'Radio Catalogo FM',
        dialFrequency: '99.9',
        band: 'FM',
      },
    },
    ...overrides,
  });
  return broadcaster;
}

// ─────────────────────────────────────────────────
// POST /api/admin/catalog-broadcasters
// ─────────────────────────────────────────────────
describe('POST /api/admin/catalog-broadcasters', () => {
  it('should allow admin to create a catalog broadcaster', async () => {
    const { auth } = await createAdmin();

    const res = await request(app)
      .post('/api/admin/catalog-broadcasters')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        companyName: 'Nova Radio FM',
        fantasyName: 'Nova FM',
        phone: '11988887777',
        email: `novaradio-${Date.now()}@emissora.com.br`,
        cnpj: '12345678000199',
        address: {
          city: 'Curitiba',
          state: 'PR',
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.broadcaster).toBeDefined();
    expect(res.body.broadcaster.companyName).toBe('Nova Radio FM');
    expect(res.body.broadcaster.isCatalogOnly).toBe(true);
    expect(res.body.broadcaster.status).toBe('approved');
    expect(res.body.message).toMatch(/sucesso/i);
  });

  it('should reject when required fields are missing', async () => {
    const { auth } = await createAdmin();

    const res = await request(app)
      .post('/api/admin/catalog-broadcasters')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ companyName: 'Incompleta' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/obrigatórios/i);
  });

  it('should reject duplicate email', async () => {
    const { auth } = await createAdmin();
    const existingEmail = `duplicate-${Date.now()}@emissora.com.br`;

    await createCatalogBroadcasterInDB({ email: existingEmail });

    const res = await request(app)
      .post('/api/admin/catalog-broadcasters')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        companyName: 'Radio Duplicada',
        phone: '11977776666',
        email: existingEmail,
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/já está cadastrado/i);
  });

  it('should reject non-admin users', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .post('/api/admin/catalog-broadcasters')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        companyName: 'Radio Teste',
        phone: '11966665555',
        email: `teste-${Date.now()}@emissora.com.br`,
      });

    expect(res.status).toBe(403);
  });

  it('should return 401 when unauthenticated', async () => {
    const res = await request(app)
      .post('/api/admin/catalog-broadcasters')
      .send({
        companyName: 'Sem Auth',
        phone: '11955554444',
        email: 'semauth@emissora.com.br',
      });

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────
// GET /api/admin/catalog-broadcasters
// ─────────────────────────────────────────────────
describe('GET /api/admin/catalog-broadcasters', () => {
  it('should list catalog broadcasters', async () => {
    const { auth } = await createAdmin();
    await createCatalogBroadcasterInDB();
    await createCatalogBroadcasterInDB({ companyName: 'Outra Radio FM' });

    const res = await request(app)
      .get('/api/admin/catalog-broadcasters')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.broadcasters.length).toBeGreaterThanOrEqual(2);
    expect(res.body.pagination).toBeDefined();
  });

  it('should filter by search term', async () => {
    const { auth } = await createAdmin();
    await createCatalogBroadcasterInDB({ companyName: 'Radio Especifica FM' });
    await createCatalogBroadcasterInDB({ companyName: 'Outra Radio AM' });

    const res = await request(app)
      .get('/api/admin/catalog-broadcasters?search=Especifica')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.broadcasters).toHaveLength(1);
    expect(res.body.broadcasters[0].companyName).toBe('Radio Especifica FM');
  });

  it('should reject non-admin users', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .get('/api/admin/catalog-broadcasters')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────
// GET /api/admin/catalog-broadcasters/:id
// ─────────────────────────────────────────────────
describe('GET /api/admin/catalog-broadcasters/:id', () => {
  it('should return catalog broadcaster details with products', async () => {
    const { auth } = await createAdmin();
    const broadcaster = await createCatalogBroadcasterInDB();

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
      .get(`/api/admin/catalog-broadcasters/${broadcaster._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.broadcaster).toBeDefined();
    expect(res.body.broadcaster.companyName).toBe('Radio Catalogo FM');
    expect(res.body.products).toBeDefined();
    expect(res.body.products).toHaveLength(1);
  });

  it('should return 404 for non-existent catalog broadcaster', async () => {
    const { auth } = await createAdmin();
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .get(`/api/admin/catalog-broadcasters/${fakeId}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(404);
  });

  it('should return 404 for non-catalog broadcaster', async () => {
    const { auth } = await createAdmin();
    const { user: regularBroadcaster } = await createBroadcaster();

    const res = await request(app)
      .get(`/api/admin/catalog-broadcasters/${regularBroadcaster._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────
// PUT /api/admin/catalog-broadcasters/:id
// ─────────────────────────────────────────────────
describe('PUT /api/admin/catalog-broadcasters/:id', () => {
  it('should update catalog broadcaster fields', async () => {
    const { auth } = await createAdmin();
    const broadcaster = await createCatalogBroadcasterInDB();

    const res = await request(app)
      .put(`/api/admin/catalog-broadcasters/${broadcaster._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        companyName: 'Radio Atualizada FM',
        phone: '11944443333',
      });

    expect(res.status).toBe(200);
    expect(res.body.broadcaster.companyName).toBe('Radio Atualizada FM');
    expect(res.body.broadcaster.phone).toBe('11944443333');
  });

  it('should reject duplicate email on update', async () => {
    const { auth } = await createAdmin();
    const b1 = await createCatalogBroadcasterInDB();
    const b2 = await createCatalogBroadcasterInDB();

    const res = await request(app)
      .put(`/api/admin/catalog-broadcasters/${b2._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ email: b1.email });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/já está cadastrado/i);
  });

  it('should return 404 for non-existent catalog broadcaster', async () => {
    const { auth } = await createAdmin();
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .put(`/api/admin/catalog-broadcasters/${fakeId}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ companyName: 'Fantasma' });

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────
// DELETE /api/admin/catalog-broadcasters/:id (soft delete)
// ─────────────────────────────────────────────────
describe('DELETE /api/admin/catalog-broadcasters/:id', () => {
  it('should soft-delete (deactivate) catalog broadcaster and its products', async () => {
    const { auth } = await createAdmin();
    const broadcaster = await createCatalogBroadcasterInDB();

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
      .delete(`/api/admin/catalog-broadcasters/${broadcaster._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/desativada/i);

    const updated = await User.findById(broadcaster._id);
    expect(updated!.status).toBe('rejected');

    const products = await Product.find({ broadcasterId: broadcaster._id });
    products.forEach((p) => expect(p.isActive).toBe(false));
  });

  it('should return 404 for non-existent catalog broadcaster', async () => {
    const { auth } = await createAdmin();
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .delete(`/api/admin/catalog-broadcasters/${fakeId}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────
// POST /api/admin/catalog-broadcasters/:id/reactivate
// ─────────────────────────────────────────────────
describe('POST /api/admin/catalog-broadcasters/:id/reactivate', () => {
  it('should reactivate a deactivated catalog broadcaster', async () => {
    const { auth } = await createAdmin();
    const broadcaster = await createCatalogBroadcasterInDB({ status: 'rejected' });

    const res = await request(app)
      .post(`/api/admin/catalog-broadcasters/${broadcaster._id}/reactivate`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/reativada/i);
    expect(res.body.broadcaster.status).toBe('approved');
  });

  it('should return 404 for non-existent catalog broadcaster', async () => {
    const { auth } = await createAdmin();
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .post(`/api/admin/catalog-broadcasters/${fakeId}/reactivate`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────
// POST /api/admin/catalog-broadcasters/:broadcasterId/products
// ─────────────────────────────────────────────────
describe('POST /api/admin/catalog-broadcasters/:broadcasterId/products', () => {
  it('should create a product for catalog broadcaster', async () => {
    const { auth } = await createAdmin();
    const broadcaster = await createCatalogBroadcasterInDB();

    const res = await request(app)
      .post(`/api/admin/catalog-broadcasters/${broadcaster._id}/products`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        spotType: 'Comercial 30s',
        timeSlot: 'Rotativo',
        pricePerInsertion: 125,
      });

    expect(res.status).toBe(201);
    expect(res.body.product).toBeDefined();
    expect(res.body.product.spotType).toBe('Comercial 30s');
    expect(res.body.product.pricePerInsertion).toBe(125);
    // Should create companion products (15s, 45s, 60s)
    expect(res.body.companionsCreated.length).toBeGreaterThanOrEqual(1);
  });

  it('should reject when required fields are missing', async () => {
    const { auth } = await createAdmin();
    const broadcaster = await createCatalogBroadcasterInDB();

    const res = await request(app)
      .post(`/api/admin/catalog-broadcasters/${broadcaster._id}/products`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ spotType: 'Comercial 30s' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/obrigatórios/i);
  });

  it('should return 404 for non-catalog broadcaster', async () => {
    const { auth } = await createAdmin();
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .post(`/api/admin/catalog-broadcasters/${fakeId}/products`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        spotType: 'Comercial 30s',
        timeSlot: 'Rotativo',
        pricePerInsertion: 100,
      });

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────
// GET /api/admin/catalog-broadcasters/:broadcasterId/products
// ─────────────────────────────────────────────────
describe('GET /api/admin/catalog-broadcasters/:broadcasterId/products', () => {
  it('should return products for the catalog broadcaster', async () => {
    const { auth } = await createAdmin();
    const broadcaster = await createCatalogBroadcasterInDB();

    await Product.create([
      {
        broadcasterId: broadcaster._id,
        spotType: 'Comercial 30s',
        duration: 30,
        timeSlot: 'Rotativo',
        netPrice: 100,
        pricePerInsertion: 125,
        isActive: true,
      },
      {
        broadcasterId: broadcaster._id,
        spotType: 'Comercial 15s',
        duration: 15,
        timeSlot: 'Rotativo',
        netPrice: 75,
        pricePerInsertion: 93.75,
        isActive: true,
      },
    ]);

    const res = await request(app)
      .get(`/api/admin/catalog-broadcasters/${broadcaster._id}/products`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.products).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────
// PUT /api/admin/catalog-products/:productId
// ─────────────────────────────────────────────────
describe('PUT /api/admin/catalog-products/:productId', () => {
  it('should update a catalog product', async () => {
    const { auth } = await createAdmin();
    const broadcaster = await createCatalogBroadcasterInDB();

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
      .put(`/api/admin/catalog-products/${product._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ pricePerInsertion: 150 });

    expect(res.status).toBe(200);
    expect(res.body.product.pricePerInsertion).toBe(150);
  });
});

// ─────────────────────────────────────────────────
// DELETE /api/admin/catalog-products/:productId
// ─────────────────────────────────────────────────
describe('DELETE /api/admin/catalog-products/:productId', () => {
  it('should delete a catalog product', async () => {
    const { auth } = await createAdmin();
    const broadcaster = await createCatalogBroadcasterInDB();

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
      .delete(`/api/admin/catalog-products/${product._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);

    const deleted = await Product.findById(product._id);
    // Product should be deactivated (soft delete) or removed
    expect(deleted === null || deleted.isActive === false).toBe(true);
  });

  it('should return 404 for non-existent product', async () => {
    const { auth } = await createAdmin();
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .delete(`/api/admin/catalog-products/${fakeId}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────
// POST /api/admin/catalog-broadcasters/:id/complete-profile
// ─────────────────────────────────────────────────
describe('POST complete-profile', () => {
  it('atualiza perfil e marca onboardingCompleted=true', async () => {
    const { auth: adminAuth } = await createAdmin();
    // Cria SEM broadcasterProfile pre-existente para evitar bug de spread de Mongoose subdoc
    const broadcaster = await User.create({
      email: `catalog-cp-${Date.now()}@emissora.com.br`,
      password: '$2a$04$fakehash',
      userType: 'broadcaster',
      status: 'approved',
      companyName: 'Radio CP FM',
      phone: '11999998888',
      cpfOrCnpj: `12345678000${Math.floor(Math.random() * 900) + 100}`,
      isCatalogOnly: true,
      emailConfirmed: true,
      onboardingCompleted: false,
    });

    // Envia broadcasterProfile completo (sem herdar subdoc existente)
    const res = await request(app)
      .post(`/api/admin/catalog-broadcasters/${broadcaster._id}/complete-profile`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .send({
        broadcasterProfile: {
          generalInfo: { stationName: 'Radio Nova FM', dialFrequency: '97.5', band: 'FM' },
          socialMedia: {},
          audienceProfile: {},
          coverage: {},
          businessRules: {},
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.broadcaster.onboardingCompleted).toBe(true);
  });

  it('retorna 404 para emissora nao-catalogo', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: regular } = await createBroadcaster();

    const res = await request(app)
      .post(`/api/admin/catalog-broadcasters/${regular._id}/complete-profile`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .send({ broadcasterProfile: {} });

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────
// GET /api/admin/catalog-orders
// ─────────────────────────────────────────────────
describe('GET catalog-orders', () => {
  it('retorna lista de pedidos de emissoras catalogo', async () => {
    const { auth: adminAuth } = await createAdmin();
    const res = await request(app)
      .get('/api/admin/catalog-orders')
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.orders)).toBe(true);
  });

  it('retorna 403 para nao-admin', async () => {
    const { auth } = await createBroadcaster();
    const res = await request(app)
      .get('/api/admin/catalog-orders')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────
// GET & DELETE /api/admin/orders/:orderId/opec
// ─────────────────────────────────────────────────
describe('GET & DELETE order opecs', () => {
  async function createTestOrderForOpec(buyerId: string) {
    return OrderModel.create({
      buyerId,
      buyerName: 'Comprador',
      buyerEmail: 'buyer@test.com',
      buyerPhone: '11999999999',
      buyerDocument: '12345678000100',
      status: 'approved',
      totalAmount: 500,
      grossAmount: 400,
      subtotal: 400,
      platformFee: 100,
      techFee: 25,
      platformSplit: 100,
      broadcasterAmount: 375,
      items: [{
        broadcasterId: new mongoose.Types.ObjectId(),
        broadcasterName: 'Radio Catalogo',
        productId: new mongoose.Types.ObjectId(),
        productName: 'Spot 30s',
        quantity: 1,
        unitPrice: 500,
        totalPrice: 500,
        itemStatus: 'pending',
        schedule: new Map([['seg', 1]]),
      }],
      payment: { method: 'pending_contact', status: 'pending', chargedAmount: 500, totalAmount: 500, walletAmountUsed: 0 },
    });
  }

  it('GET opecs retorna lista vazia para pedido sem opec', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: advertiser } = await createAdvertiser();
    const order = await createTestOrderForOpec(advertiser._id.toString());

    const res = await request(app)
      .get(`/api/admin/orders/${order._id}/opec`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.opecs)).toBe(true);
  });

  it('GET opecs retorna 404 para pedido inexistente', async () => {
    const { auth: adminAuth } = await createAdmin();
    const res = await request(app)
      .get(`/api/admin/orders/${new mongoose.Types.ObjectId()}/opec`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);
    expect(res.status).toBe(404);
  });

  it('GET opecs retorna 403 para nao-admin', async () => {
    const { auth } = await createBroadcaster();
    const res = await request(app)
      .get(`/api/admin/orders/${new mongoose.Types.ObjectId()}/opec`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);
    expect(res.status).toBe(403);
  });

  it('DELETE opec retorna 404 para opec inexistente', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: advertiser } = await createAdvertiser();
    const order = await createTestOrderForOpec(advertiser._id.toString());

    const res = await request(app)
      .delete(`/api/admin/orders/${order._id}/opec/${new mongoose.Types.ObjectId()}`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);
    expect(res.status).toBe(404);
  });

  it('DELETE opec retorna 403 para nao-admin', async () => {
    const { auth } = await createBroadcaster();
    const res = await request(app)
      .delete(`/api/admin/orders/${new mongoose.Types.ObjectId()}/opec/${new mongoose.Types.ObjectId()}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);
    expect(res.status).toBe(403);
  });
});
