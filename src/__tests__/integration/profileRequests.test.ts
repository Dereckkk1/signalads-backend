/**
 * Integration Tests — Profile Requests API
 *
 * Tests real HTTP endpoints end-to-end.
 * POST   /api/profile-requests              (broadcaster: create)
 * GET    /api/profile-requests/my-requests   (broadcaster: list own)
 * GET    /api/profile-requests/count-pending  (admin)
 * GET    /api/profile-requests               (admin: list all)
 * POST   /api/profile-requests/:id/approve    (admin)
 * POST   /api/profile-requests/:id/reject     (admin)
 */

import '../helpers/mocks';

import request from 'supertest';
import express, { Application, Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import hpp from 'hpp';
import mongoose from 'mongoose';

import { mongoSanitize, xssSanitize } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';
import profileRequestRoutes from '../../routes/profileRequestRoutes';
import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import {
  createAdmin,
  createBroadcaster,
  createAdvertiser,
} from '../helpers/authHelper';
import { ProfileRequest } from '../../models/ProfileRequest';
import { User } from '../../models/User';

function createApp(): Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(mongoSanitize);
  app.use(xssSanitize);
  app.use(hpp());
  app.use(csrfProtection);
  app.use('/api/profile-requests', profileRequestRoutes);
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
// POST /api/profile-requests (broadcaster: create)
// ─────────────────────────────────────────────────
describe('POST /api/profile-requests', () => {
  it('should create a profile change request', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/profile-requests')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        requestedData: {
          phone: '11999998888',
          companyName: 'Radio Updated FM',
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.message).toMatch(/enviada/i);
    expect(res.body.request.status).toBe('pending');
  });

  it('should reject when requestedData is empty', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/profile-requests')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ requestedData: {} });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/dados/i);
  });

  it('should reject when requestedData is missing', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/profile-requests')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/dados/i);
  });

  it('should reject duplicate pending request', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();

    await ProfileRequest.create({
      broadcasterId: broadcaster._id,
      status: 'pending',
      requestedData: { phone: '11111111111' },
    });

    const res = await request(app)
      .post('/api/profile-requests')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ requestedData: { phone: '22222222222' } });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/pendente/i);
  });

  it('should return 403 for non-broadcaster', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .post('/api/profile-requests')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ requestedData: { phone: '1111' } });

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────
// GET /api/profile-requests/my-requests (broadcaster)
// ─────────────────────────────────────────────────
describe('GET /api/profile-requests/my-requests', () => {
  it('should return own requests for broadcaster', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();

    await ProfileRequest.create({
      broadcasterId: broadcaster._id,
      status: 'pending',
      requestedData: { phone: '11999998888' },
    });

    const res = await request(app)
      .get('/api/profile-requests/my-requests')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.requests).toHaveLength(1);
    expect(res.body.pagination.total).toBe(1);
  });

  it('should not return other broadcasters requests', async () => {
    const { auth } = await createBroadcaster();
    const { user: otherBroadcaster } = await createBroadcaster();

    await ProfileRequest.create({
      broadcasterId: otherBroadcaster._id,
      status: 'pending',
      requestedData: { phone: '1111' },
    });

    const res = await request(app)
      .get('/api/profile-requests/my-requests')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.requests).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────
// GET /api/profile-requests/count-pending (admin)
// ─────────────────────────────────────────────────
describe('GET /api/profile-requests/count-pending', () => {
  it('should return count of pending profile requests', async () => {
    const { user: broadcaster } = await createBroadcaster();

    await ProfileRequest.create({
      broadcasterId: broadcaster._id,
      status: 'pending',
      requestedData: { phone: '111' },
    });
    await ProfileRequest.create({
      broadcasterId: broadcaster._id,
      status: 'approved',
      requestedData: { phone: '222' },
    });

    const { auth } = await createAdmin();

    const res = await request(app)
      .get('/api/profile-requests/count-pending')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });

  it('should return 403 for non-admin', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .get('/api/profile-requests/count-pending')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────
// POST /api/profile-requests/:id/approve (admin)
// ─────────────────────────────────────────────────
describe('POST /api/profile-requests/:id/approve', () => {
  it('should approve and update broadcaster profile', async () => {
    const { user: broadcaster } = await createBroadcaster();

    const req = await ProfileRequest.create({
      broadcasterId: broadcaster._id,
      status: 'pending',
      requestedData: {
        phone: '11777777777',
        companyName: 'Radio Nova FM',
      },
    });

    const { auth } = await createAdmin();

    const res = await request(app)
      .post(`/api/profile-requests/${req._id}/approve`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/aprovada/i);
    expect(res.body.request.status).toBe('approved');

    // Verify broadcaster was updated
    const updated = await User.findById(broadcaster._id);
    expect(updated!.phone).toBe('11777777777');
    expect(updated!.companyName).toBe('Radio Nova FM');
  });

  it('should reject already processed request', async () => {
    const { user: broadcaster } = await createBroadcaster();

    const req = await ProfileRequest.create({
      broadcasterId: broadcaster._id,
      status: 'approved',
      requestedData: { phone: '111' },
    });

    const { auth } = await createAdmin();

    const res = await request(app)
      .post(`/api/profile-requests/${req._id}/approve`)
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
      .post(`/api/profile-requests/${fakeId}/approve`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({});

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────
// POST /api/profile-requests/:id/reject (admin)
// ─────────────────────────────────────────────────
describe('POST /api/profile-requests/:id/reject', () => {
  it('should reject a pending request with reason', async () => {
    const { user: broadcaster } = await createBroadcaster();

    const req = await ProfileRequest.create({
      broadcasterId: broadcaster._id,
      status: 'pending',
      requestedData: { phone: '111' },
    });

    const { auth } = await createAdmin();

    const res = await request(app)
      .post(`/api/profile-requests/${req._id}/reject`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ rejectionReason: 'Dados incompletos ou incorretos.' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/recusada/i);
    expect(res.body.request.status).toBe('rejected');
  });

  it('should reject when reason is too short', async () => {
    const { user: broadcaster } = await createBroadcaster();

    const req = await ProfileRequest.create({
      broadcasterId: broadcaster._id,
      status: 'pending',
      requestedData: { phone: '111' },
    });

    const { auth } = await createAdmin();

    const res = await request(app)
      .post(`/api/profile-requests/${req._id}/reject`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ rejectionReason: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/10 caracteres/i);
  });
});
