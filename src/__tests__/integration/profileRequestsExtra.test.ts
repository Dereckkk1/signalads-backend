/**
 * Integration Tests — Profile Requests API (Extra Coverage)
 *
 * Cobre branches não testados em profileRequestController.ts:
 * - GET /api/profile-requests              — getAllProfileRequests (paginação, filtros)
 * - GET /api/profile-requests/count-pending — countPendingProfileRequests
 * - POST /api/profile-requests/:id/reject  — rejectProfileRequest com motivo
 * - Edge cases em createProfileRequest
 */

import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';
import express from 'express';
import cookieParser from 'cookie-parser';

import { mongoSanitize, xssSanitize, dedupeQuery } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';
import profileRequestRoutes from '../../routes/profileRequestRoutes';

import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { createAdmin, createBroadcaster, createAdvertiser } from '../helpers/authHelper';
import { ProfileRequest } from '../../models/ProfileRequest';

function createApp(): Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(mongoSanitize);
  app.use(xssSanitize);
  app.use(dedupeQuery);
  app.use(csrfProtection);
  app.use('/api/profile-requests', profileRequestRoutes);
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

// ─── getAllProfileRequests ────────────────────────────────────────────────

describe('GET /api/profile-requests — extras', () => {
  it('lista todas as solicitacoes com paginacao', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: broadcaster } = await createBroadcaster();

    await ProfileRequest.create([
      {
        broadcasterId: broadcaster._id,
        status: 'pending',
        requestedData: { logo: 'https://example.com/logo.png' },
      },
      {
        broadcasterId: broadcaster._id,
        status: 'approved',
        requestedData: { generalInfo: { stationName: 'Rádio Nova' } },
      },
    ]);

    const res = await request(app)
      .get('/api/profile-requests?page=1&limit=1')
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
  });

  it('retorna 403 para broadcaster', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .get('/api/profile-requests')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });
});

// ─── countPendingProfileRequests ─────────────────────────────────────────

describe('GET /api/profile-requests/count-pending', () => {
  it('retorna contagem de solicitacoes de perfil pendentes', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: broadcaster } = await createBroadcaster();

    await ProfileRequest.create([
      { broadcasterId: broadcaster._id, status: 'pending', requestedData: { logo: 'test.png' } },
      { broadcasterId: broadcaster._id, status: 'approved', requestedData: { stationName: 'Test' } },
    ]);

    const res = await request(app)
      .get('/api/profile-requests/count-pending')
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });

  it('retorna 403 para broadcaster', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .get('/api/profile-requests/count-pending')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });
});

// ─── rejectProfileRequest com motivo ─────────────────────────────────────

describe('POST /api/profile-requests/:id/reject — extras', () => {
  it('rejeita solicitacao com motivo', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: broadcaster } = await createBroadcaster();

    const profileRequest = await ProfileRequest.create({
      broadcasterId: broadcaster._id,
      status: 'pending',
      requestedData: { logo: 'https://example.com/logo.png' },
    });

    const res = await request(app)
      .post(`/api/profile-requests/${profileRequest._id}/reject`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .send({ rejectionReason: 'Logo não atende padrões da plataforma' });

    expect(res.status).toBe(200);
    const updated = await ProfileRequest.findById(profileRequest._id);
    expect(updated!.status).toBe('rejected');
  });

  it('retorna 404 para solicitacao inexistente', async () => {
    const { auth: adminAuth } = await createAdmin();

    const res = await request(app)
      .post('/api/profile-requests/507f1f77bcf86cd799439011/reject')
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .send({ rejectionReason: 'Motivo suficientemente longo para passar a validacao' });

    expect(res.status).toBe(404);
  });

  it('retorna 403 para broadcaster', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/profile-requests/507f1f77bcf86cd799439011/reject')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ rejectionReason: 'X' });

    expect(res.status).toBe(403);
  });
});

// ─── createProfileRequest extras ─────────────────────────────────────────

describe('POST /api/profile-requests — extras', () => {
  it('retorna 403 para advertiser', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .post('/api/profile-requests')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ requestType: 'logo', description: 'Teste', newData: {} });

    expect(res.status).toBe(403);
  });

  it('retorna 401 sem autenticacao', async () => {
    const res = await request(app)
      .post('/api/profile-requests')
      .send({ requestType: 'logo', description: 'Teste' });

    expect(res.status).toBe(401);
  });
});
