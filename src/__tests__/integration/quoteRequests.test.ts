/**
 * Integration Tests — Quote Requests API
 *
 * Tests real HTTP endpoints end-to-end.
 * POST   /api/quotes/create            (client: create from cart)
 * GET    /api/quotes/my-requests       (client: list own)
 * GET    /api/quotes/:requestNumber    (client/admin: details)
 * GET    /api/quotes/admin/all         (admin: list all)
 * GET    /api/quotes/admin/stats       (admin: statistics)
 * PATCH  /api/quotes/admin/:rn/status  (admin: update status)
 * PATCH  /api/quotes/admin/:rn/notes   (admin: update notes)
 */

import '../helpers/mocks';

import request from 'supertest';
import express, { Application, Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import hpp from 'hpp';
import mongoose from 'mongoose';

import { mongoSanitize, xssSanitize } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';
import quoteRequestRoutes from '../../routes/quoteRequestRoutes';
import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import {
  createAdmin,
  createAdvertiser,
  createBroadcaster,
} from '../helpers/authHelper';
import QuoteRequest from '../../models/QuoteRequest';
import { Cart } from '../../models/Cart';
import { Product } from '../../models/Product';

function createApp(): Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(mongoSanitize);
  app.use(xssSanitize);
  app.use(hpp());
  app.use(csrfProtection);
  app.use('/api/quotes', quoteRequestRoutes);
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Rota não encontrada' });
  });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.status || 500).json({ error: 'Erro interno do servidor' });
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

/** Helper: creates a cart with an item that has material attached */
async function setupCartWithMaterial() {
  const { user: broadcaster } = await createBroadcaster();
  const { user: advertiser, auth } = await createAdvertiser();

  const product = await Product.create({
    broadcasterId: broadcaster._id,
    spotType: 'Comercial 30s',
    duration: 30,
    timeSlot: 'Rotativo',
    netPrice: 100,
    pricePerInsertion: 125,
    isActive: true,
  });

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
      material: {
        type: 'text',
        text: 'Promo text for testing',
        wordCount: 5,
        textDuration: 10,
        uploadedAt: new Date(),
      },
    }],
  });

  return { advertiser, auth, product, broadcaster };
}

/**
 * Helper: inserts a QuoteRequest directly into the collection (bypassing the
 * pre-save hook that overwrites requestNumber). This lets us control the
 * requestNumber for deterministic test assertions.
 */
async function insertQuoteRequest(data: {
  requestNumber: string;
  buyer: mongoose.Types.ObjectId;
  buyerName: string;
  buyerEmail: string;
  buyerType: 'advertiser' | 'agency';
  totalValue: number;
  status: string;
  adminNotes?: string;
}) {
  const doc = {
    ...data,
    items: [{
      productId: new mongoose.Types.ObjectId().toString(),
      productName: 'Comercial 30s',
      broadcasterName: 'Radio FM',
      broadcasterId: new mongoose.Types.ObjectId().toString(),
      quantity: 1,
      unitPrice: 100,
      totalPrice: 100,
      material: { type: 'text', text: 'Test' },
    }],
    statusHistory: [{
      status: data.status,
      changedBy: data.buyer,
      changedAt: new Date(),
      notes: 'Seed',
    }],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await QuoteRequest.collection.insertOne(doc);
  return doc;
}

// ─────────────────────────────────────────────────
// POST /api/quotes/create
// ─────────────────────────────────────────────────
describe('POST /api/quotes/create', () => {
  it('should create a quote request from cart', async () => {
    const { auth } = await setupCartWithMaterial();

    const res = await request(app)
      .post('/api/quotes/create')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ clientNotes: 'Please contact me ASAP' });

    expect(res.status).toBe(201);
    expect(res.body.message).toMatch(/sucesso/i);
    expect(res.body.quoteRequest.requestNumber).toMatch(/^REQ-/);
    expect(res.body.quoteRequest.status).toBe('pending');
  });

  it('should reject when cart is empty', async () => {
    const { user: advertiser, auth } = await createAdvertiser();

    await Cart.create({ userId: advertiser._id, items: [] });

    const res = await request(app)
      .post('/api/quotes/create')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/vazio/i);
  });

  it('should reject when cart items lack material', async () => {
    const { user: broadcaster } = await createBroadcaster();
    const { user: advertiser, auth } = await createAdvertiser();

    const product = await Product.create({
      broadcasterId: broadcaster._id,
      spotType: 'Comercial 30s',
      duration: 30,
      timeSlot: 'Rotativo',
      pricePerInsertion: 125,
      isActive: true,
    });

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
      .post('/api/quotes/create')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/material/i);
  });

  it('should return 401 when unauthenticated', async () => {
    const res = await request(app)
      .post('/api/quotes/create')
      .send({});

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────
// GET /api/quotes/my-requests
// ─────────────────────────────────────────────────
describe('GET /api/quotes/my-requests', () => {
  it('should return own quote requests', async () => {
    const { user: advertiser, auth } = await createAdvertiser();

    await insertQuoteRequest({
      requestNumber: 'REQ-TEST-001',
      buyer: advertiser._id,
      buyerName: 'Test Advertiser',
      buyerEmail: advertiser.email,
      buyerType: 'advertiser',
      totalValue: 625,
      status: 'pending',
    });

    const res = await request(app)
      .get('/api/quotes/my-requests')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].requestNumber).toBe('REQ-TEST-001');
    // adminNotes should NOT be exposed (field excluded by select)
    expect(res.body[0].adminNotes).toBeUndefined();
  });

  it('should return empty for user with no requests', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .get('/api/quotes/my-requests')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────
// GET /api/quotes/:requestNumber
// ─────────────────────────────────────────────────
describe('GET /api/quotes/:requestNumber', () => {
  it('should return quote details for the owner', async () => {
    const { user: advertiser, auth } = await createAdvertiser();

    await insertQuoteRequest({
      requestNumber: 'REQ-TEST-050',
      buyer: advertiser._id,
      buyerName: 'Test',
      buyerEmail: advertiser.email,
      buyerType: 'advertiser',
      totalValue: 300,
      status: 'pending',
      adminNotes: 'Internal admin note',
    });

    const res = await request(app)
      .get('/api/quotes/REQ-TEST-050')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.requestNumber).toBe('REQ-TEST-050');
    // adminNotes should NOT be visible to non-admin owner
    expect(res.body.adminNotes).toBeUndefined();
  });

  it('should return 403 for user who is not the owner', async () => {
    const { user: owner } = await createAdvertiser();
    const { auth: otherAuth } = await createAdvertiser();

    await insertQuoteRequest({
      requestNumber: 'REQ-TEST-051',
      buyer: owner._id,
      buyerName: 'Owner',
      buyerEmail: owner.email,
      buyerType: 'advertiser',
      totalValue: 100,
      status: 'pending',
    });

    const res = await request(app)
      .get('/api/quotes/REQ-TEST-051')
      .set('Cookie', otherAuth.cookieHeader)
      .set('X-CSRF-Token', otherAuth.csrfHeader);

    expect(res.status).toBe(403);
  });

  it('should return 404 for non-existent request number', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .get('/api/quotes/REQ-DOESNT-EXIST')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────
// GET /api/quotes/admin/stats (admin)
// ─────────────────────────────────────────────────
describe('GET /api/quotes/admin/stats', () => {
  it('should return statistics for admin', async () => {
    const { auth } = await createAdmin();

    const res = await request(app)
      .get('/api/quotes/admin/stats')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.byStatus).toBeDefined();
    expect(res.body.total).toBeDefined();
    expect(res.body.values).toBeDefined();
  });

  it('should return 403 for non-admin', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .get('/api/quotes/admin/stats')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────
// PATCH /api/quotes/admin/:requestNumber/status (admin)
// ─────────────────────────────────────────────────
describe('PATCH /api/quotes/admin/:requestNumber/status', () => {
  it('should update quote request status', async () => {
    const { user: advertiser } = await createAdvertiser();

    await insertQuoteRequest({
      requestNumber: 'REQ-TEST-060',
      buyer: advertiser._id,
      buyerName: 'Test',
      buyerEmail: advertiser.email,
      buyerType: 'advertiser',
      totalValue: 100,
      status: 'pending',
    });

    const { auth } = await createAdmin();

    const res = await request(app)
      .patch('/api/quotes/admin/REQ-TEST-060/status')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ status: 'contacted', notes: 'Called the client' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/atualizado/i);
    expect(res.body.request.status).toBe('contacted');
  });

  it('should reject invalid status', async () => {
    const { user: advertiser } = await createAdvertiser();

    await insertQuoteRequest({
      requestNumber: 'REQ-TEST-061',
      buyer: advertiser._id,
      buyerName: 'Test',
      buyerEmail: advertiser.email,
      buyerType: 'advertiser',
      totalValue: 100,
      status: 'pending',
    });

    const { auth } = await createAdmin();

    const res = await request(app)
      .patch('/api/quotes/admin/REQ-TEST-061/status')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ status: 'invalid_status' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/inválido/i);
  });

  it('should return 404 for non-existent request', async () => {
    const { auth } = await createAdmin();

    const res = await request(app)
      .patch('/api/quotes/admin/REQ-NOPE/status')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ status: 'contacted' });

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────
// PATCH /api/quotes/admin/:requestNumber/notes (admin)
// ─────────────────────────────────────────────────
describe('PATCH /api/quotes/admin/:requestNumber/notes', () => {
  it('should update admin notes', async () => {
    const { user: advertiser } = await createAdvertiser();

    await insertQuoteRequest({
      requestNumber: 'REQ-TEST-070',
      buyer: advertiser._id,
      buyerName: 'Test',
      buyerEmail: advertiser.email,
      buyerType: 'advertiser',
      totalValue: 100,
      status: 'pending',
    });

    const { auth } = await createAdmin();

    const res = await request(app)
      .patch('/api/quotes/admin/REQ-TEST-070/notes')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ adminNotes: 'Internal note about this client.' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/atualizadas/i);

    const updated = await QuoteRequest.findOne({ requestNumber: 'REQ-TEST-070' });
    expect(updated!.adminNotes).toBe('Internal note about this client.');
  });

  it('should return 404 for non-existent request', async () => {
    const { auth } = await createAdmin();

    const res = await request(app)
      .patch('/api/quotes/admin/REQ-NOPE/notes')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ adminNotes: 'Note' });

    expect(res.status).toBe(404);
  });
});
