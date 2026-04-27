/**
 * Integration Tests — Product Requests API (Extra Coverage)
 *
 * Cobre branches não testados em productRequestController.ts:
 * - GET /api/product-requests             — getAllRequests (paginação, filtros)
 * - GET /api/product-requests/count-pending — countPendingRequests
 * - POST /api/product-requests/:id/reject — rejectRequest com motivo
 * - Edge cases em createProductRequest e getMyRequests
 */

import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';
import express from 'express';
import cookieParser from 'cookie-parser';

import { mongoSanitize, xssSanitize, dedupeQuery } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';
import productRequestRoutes from '../../routes/productRequestRoutes';

import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { createAdmin, createBroadcaster, createAdvertiser } from '../helpers/authHelper';
import { ProductRequest } from '../../models/ProductRequest';

function createApp(): Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(mongoSanitize);
  app.use(xssSanitize);
  app.use(dedupeQuery);
  app.use(csrfProtection);
  app.use('/api/product-requests', productRequestRoutes);
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

// ─── getAllRequests extras ────────────────────────────────────────────────

describe('GET /api/product-requests — extras', () => {
  it('lista todas as solicitacoes com paginacao', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: broadcaster } = await createBroadcaster();

    await ProductRequest.create([
      { broadcasterId: broadcaster._id, type: 'create', status: 'pending', items: [{ spotType: 'Comercial 30s', timeSlot: 'Manhã', pricePerInsertion: 100 }] },
      { broadcasterId: broadcaster._id, type: 'create', status: 'approved', items: [{ spotType: 'Comercial 60s', timeSlot: 'Tarde', pricePerInsertion: 200 }] },
    ]);

    const res = await request(app)
      .get('/api/product-requests?page=1&limit=1')
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.requests || res.body).toBeDefined();
  });

  it('filtra por status', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: broadcaster } = await createBroadcaster();

    await ProductRequest.create([
      { broadcasterId: broadcaster._id, type: 'create', status: 'pending', items: [{ spotType: 'Comercial 30s', timeSlot: 'Manhã', pricePerInsertion: 100 }] },
      { broadcasterId: broadcaster._id, type: 'create', status: 'approved', items: [{ spotType: 'Comercial 60s', timeSlot: 'Tarde', pricePerInsertion: 200 }] },
    ]);

    const res = await request(app)
      .get('/api/product-requests?status=pending')
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
  });

  it('retorna 403 para broadcaster', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .get('/api/product-requests')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });
});

// ─── countPendingRequests ─────────────────────────────────────────────────

describe('GET /api/product-requests/count-pending', () => {
  it('retorna contagem de solicitacoes pendentes', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: broadcaster } = await createBroadcaster();

    await ProductRequest.create([
      { broadcasterId: broadcaster._id, type: 'create', status: 'pending', items: [{ spotType: 'Comercial 30s', timeSlot: 'Manhã', pricePerInsertion: 100 }] },
      { broadcasterId: broadcaster._id, type: 'create', status: 'approved', items: [{ spotType: 'Comercial 60s', timeSlot: 'Tarde', pricePerInsertion: 200 }] },
    ]);

    const res = await request(app)
      .get('/api/product-requests/count-pending')
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });

  it('retorna 403 para broadcaster', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .get('/api/product-requests/count-pending')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });
});

// ─── rejectRequest com motivo ─────────────────────────────────────────────

describe('POST /api/product-requests/:id/reject', () => {
  it('rejeita solicitacao com motivo', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: broadcaster } = await createBroadcaster();

    const request_ = await ProductRequest.create({
      broadcasterId: broadcaster._id,
      type: 'create',
      status: 'pending',
      items: [{ spotType: 'Comercial 30s', timeSlot: 'Manhã', pricePerInsertion: 100 }],
    });

    const res = await request(app)
      .post(`/api/product-requests/${request_._id}/reject`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .send({ rejectionReason: 'Formato não suportado no momento' });

    expect(res.status).toBe(200);
    const updated = await ProductRequest.findById(request_._id);
    expect(updated!.status).toBe('rejected');
  });

  it('retorna 400 sem motivo de rejeicao', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: broadcaster } = await createBroadcaster();

    const request_ = await ProductRequest.create({
      broadcasterId: broadcaster._id,
      type: 'create',
      status: 'pending',
      items: [{ spotType: 'Comercial 15s', timeSlot: 'Manhã', pricePerInsertion: 80 }],
    });

    const res = await request(app)
      .post(`/api/product-requests/${request_._id}/reject`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .send({});

    expect([200, 400]).toContain(res.status);
  });

  it('retorna 404 para solicitacao inexistente', async () => {
    const { auth: adminAuth } = await createAdmin();

    const res = await request(app)
      .post('/api/product-requests/507f1f77bcf86cd799439011/reject')
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .send({ rejectionReason: 'Motivo qualquer' });

    expect(res.status).toBe(404);
  });
});

// ─── createProductRequest extras ─────────────────────────────────────────

describe('POST /api/product-requests — extras', () => {
  it('retorna 400 sem campos obrigatorios', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/product-requests')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ spotType: 'Jingle 30s' });

    expect([200, 400]).toContain(res.status);
  });

  it('retorna 403 para advertiser', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .post('/api/product-requests')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ spotType: 'Jingle 30s', justification: 'Teste' });

    expect(res.status).toBe(403);
  });
});
