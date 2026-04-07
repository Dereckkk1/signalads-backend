/**
 * Integration Tests — Product Requests API
 *
 * Tests real HTTP endpoints end-to-end.
 * POST   /api/product-requests              (broadcaster: create)
 * GET    /api/product-requests/my-requests   (broadcaster: list own)
 * GET    /api/product-requests               (admin: list all)
 * GET    /api/product-requests/pending        (admin: list pending)
 * GET    /api/product-requests/count-pending  (admin: count)
 * POST   /api/product-requests/:id/approve    (admin)
 * POST   /api/product-requests/:id/reject     (admin)
 */

import '../helpers/mocks';

import request from 'supertest';
import express, { Application, Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import hpp from 'hpp';
import mongoose from 'mongoose';

import { mongoSanitize, xssSanitize } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';
import productRequestRoutes from '../../routes/productRequestRoutes';
import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import {
  createAdmin,
  createBroadcaster,
  createAdvertiser,
} from '../helpers/authHelper';
import { ProductRequest } from '../../models/ProductRequest';
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
  app.use('/api/product-requests', productRequestRoutes);
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

// ─────────────────────────────────────────────────
// POST /api/product-requests (broadcaster: create)
// ─────────────────────────────────────────────────
describe('POST /api/product-requests', () => {
  it('should create a product request of type create', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/product-requests')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        type: 'create',
        items: [
          { spotType: 'Comercial 30s', timeSlot: 'Rotativo', pricePerInsertion: 100 },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.message).toMatch(/enviada/i);
    expect(res.body.request.type).toBe('create');
    expect(res.body.request.status).toBe('pending');
  });

  it('should reject invalid type', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/product-requests')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ type: 'invalid' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/inválido/i);
  });

  it('should reject create without items', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/product-requests')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ type: 'create', items: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/pelo menos um/i);
  });

  it('should reject create with invalid item (missing spotType)', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/product-requests')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        type: 'create',
        items: [{ timeSlot: 'Rotativo', pricePerInsertion: 100 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/spotType/i);
  });

  it('should reject create with price <= 0', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/product-requests')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        type: 'create',
        items: [{ spotType: 'Comercial 30s', timeSlot: 'Rotativo', pricePerInsertion: 0 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/maior que zero/i);
  });

  it('should create edit request for own product', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();

    const product = await Product.create({
      broadcasterId: broadcaster._id,
      spotType: 'Comercial 30s',
      duration: 30,
      timeSlot: 'Rotativo',
      pricePerInsertion: 100,
      isActive: true,
    });

    const res = await request(app)
      .post('/api/product-requests')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        type: 'edit',
        productId: product._id.toString(),
        editedFields: { pricePerInsertion: 150 },
      });

    expect(res.status).toBe(201);
    expect(res.body.request.type).toBe('edit');
  });

  it('should reject edit without productId', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/product-requests')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ type: 'edit', editedFields: { pricePerInsertion: 200 } });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/productId/i);
  });

  it('should reject duplicate pending request for same product', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();

    const product = await Product.create({
      broadcasterId: broadcaster._id,
      spotType: 'Comercial 30s',
      duration: 30,
      timeSlot: 'Rotativo',
      pricePerInsertion: 100,
      isActive: true,
    });

    await ProductRequest.create({
      broadcasterId: broadcaster._id,
      type: 'edit',
      status: 'pending',
      productId: product._id,
      editedFields: { pricePerInsertion: 150 },
    });

    const res = await request(app)
      .post('/api/product-requests')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        type: 'delete',
        productId: product._id.toString(),
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/já existe/i);
  });

  it('should return 403 for non-broadcaster', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .post('/api/product-requests')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ type: 'create', items: [] });

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────
// GET /api/product-requests/my-requests (broadcaster)
// ─────────────────────────────────────────────────
describe('GET /api/product-requests/my-requests', () => {
  it('should return own requests for broadcaster', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();

    await ProductRequest.create({
      broadcasterId: broadcaster._id,
      type: 'create',
      status: 'pending',
      items: [{ spotType: 'Comercial 30s', timeSlot: 'Rotativo', pricePerInsertion: 100 }],
    });

    const res = await request(app)
      .get('/api/product-requests/my-requests')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.requests).toHaveLength(1);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.total).toBe(1);
  });

  it('should not return other broadcasters requests', async () => {
    const { auth } = await createBroadcaster();
    const { user: otherBroadcaster } = await createBroadcaster();

    await ProductRequest.create({
      broadcasterId: otherBroadcaster._id,
      type: 'create',
      status: 'pending',
      items: [{ spotType: 'Comercial 30s', timeSlot: 'Rotativo', pricePerInsertion: 100 }],
    });

    const res = await request(app)
      .get('/api/product-requests/my-requests')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.requests).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────
// GET /api/product-requests/count-pending (admin)
// ─────────────────────────────────────────────────
describe('GET /api/product-requests/count-pending', () => {
  it('should return count of pending requests', async () => {
    const { user: broadcaster } = await createBroadcaster();

    await ProductRequest.create({
      broadcasterId: broadcaster._id,
      type: 'create',
      status: 'pending',
      items: [{ spotType: 'Comercial 30s', timeSlot: 'Rotativo', pricePerInsertion: 100 }],
    });
    await ProductRequest.create({
      broadcasterId: broadcaster._id,
      type: 'create',
      status: 'approved',
      items: [{ spotType: 'Comercial 15s', timeSlot: 'Rotativo', pricePerInsertion: 75 }],
    });

    const { auth } = await createAdmin();

    const res = await request(app)
      .get('/api/product-requests/count-pending')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });

  it('should return 403 for non-admin', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .get('/api/product-requests/count-pending')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────
// POST /api/product-requests/:id/approve (admin)
// ─────────────────────────────────────────────────
describe('POST /api/product-requests/:id/approve', () => {
  it('should approve a create request and create products', async () => {
    const { user: broadcaster } = await createBroadcaster();

    const req = await ProductRequest.create({
      broadcasterId: broadcaster._id,
      type: 'create',
      status: 'pending',
      items: [{ spotType: 'Comercial 30s', timeSlot: 'Rotativo', pricePerInsertion: 100 }],
    });

    const { auth } = await createAdmin();

    const res = await request(app)
      .post(`/api/product-requests/${req._id}/approve`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/aprovada/i);
    expect(res.body.request.status).toBe('approved');

    // Verify product was created
    const products = await Product.find({ broadcasterId: broadcaster._id });
    expect(products.length).toBeGreaterThanOrEqual(1);
  });

  it('should reject already processed request', async () => {
    const { user: broadcaster } = await createBroadcaster();

    const req = await ProductRequest.create({
      broadcasterId: broadcaster._id,
      type: 'create',
      status: 'approved',
      items: [{ spotType: 'Comercial 30s', timeSlot: 'Rotativo', pricePerInsertion: 100 }],
    });

    const { auth } = await createAdmin();

    const res = await request(app)
      .post(`/api/product-requests/${req._id}/approve`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/já foi processada/i);
  });

  it('should return 404 for non-existent request', async () => {
    const { auth } = await createAdmin();
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .post(`/api/product-requests/${fakeId}/approve`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({});

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────
// POST /api/product-requests/:id/reject (admin)
// ─────────────────────────────────────────────────
describe('POST /api/product-requests/:id/reject', () => {
  it('should reject a pending request with reason', async () => {
    const { user: broadcaster } = await createBroadcaster();

    const req = await ProductRequest.create({
      broadcasterId: broadcaster._id,
      type: 'create',
      status: 'pending',
      items: [{ spotType: 'Comercial 30s', timeSlot: 'Rotativo', pricePerInsertion: 100 }],
    });

    const { auth } = await createAdmin();

    const res = await request(app)
      .post(`/api/product-requests/${req._id}/reject`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ rejectionReason: 'Preco fora do padrao para esta regiao.' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/recusada/i);
    expect(res.body.request.status).toBe('rejected');
    expect(res.body.request.rejectionReason).toMatch(/padrao/i);
  });

  it('should reject when reason is too short', async () => {
    const { user: broadcaster } = await createBroadcaster();

    const req = await ProductRequest.create({
      broadcasterId: broadcaster._id,
      type: 'create',
      status: 'pending',
      items: [{ spotType: 'Comercial 30s', timeSlot: 'Rotativo', pricePerInsertion: 100 }],
    });

    const { auth } = await createAdmin();

    const res = await request(app)
      .post(`/api/product-requests/${req._id}/reject`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ rejectionReason: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/10 caracteres/i);
  });

  it('should return 404 for non-existent request', async () => {
    const { auth } = await createAdmin();
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .post(`/api/product-requests/${fakeId}/reject`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ rejectionReason: 'Reason with enough characters' });

    expect(res.status).toBe(404);
  });
});
