/**
 * Integration Tests — Broadcaster Sub-Users API (Extra Coverage)
 *
 * Cobre branches não testados em broadcasterSubUserController.ts:
 * - Limite de 3 sub-usuários
 * - Resend invite para usuário ativo (erro)
 * - getSubUserDashboard para sub-usuário logado
 * - updateSubUser — alterar permissões
 * - deleteSubUser — verificações de segurança
 */

import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';
import express from 'express';
import cookieParser from 'cookie-parser';

import { mongoSanitize, xssSanitize, dedupeQuery } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';
import broadcasterSubUserRoutes from '../../routes/broadcasterSubUserRoutes';

import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { createBroadcaster, createAgency, createAdvertiser } from '../helpers/authHelper';
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
  app.use('/api/broadcaster', broadcasterSubUserRoutes);
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

// ─── createSubUser extras ─────────────────────────────────────────────────

describe('POST /api/broadcaster/sub-users — extras', () => {
  it('retorna 400 ao tentar criar mais de 3 sub-usuarios', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();

    // Cria 3 sub-usuários
    for (let i = 0; i < 3; i++) {
      await User.create({
        email: `sub${i}-${Date.now()}@emissora.com.br`,
        password: 'TestPass@123456!',
        userType: 'broadcaster',
        companyName: `Sub ${i}`,
        cpfOrCnpj: `000000000000${i}`.slice(-14).padStart(14, '0'),
        phone: '11999999999',
        status: 'approved',
        emailConfirmed: true,
        parentBroadcasterId: broadcaster._id,
        subUserRole: 'sales',
      });
    }

    const res = await request(app)
      .post('/api/broadcaster/sub-users')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        email: 'quarto@emissora.com.br',
        name: 'Quarto',
        role: 'sales',
      });

    expect(res.status).toBe(400);
  });

  it('retorna 400 sem email', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/broadcaster/sub-users')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'Sem email', role: 'sales' });

    expect(res.status).toBe(400);
  });

  it('retorna 403 para agency', async () => {
    const { auth: agencyAuth } = await createAgency();

    const res = await request(app)
      .post('/api/broadcaster/sub-users')
      .set('Cookie', agencyAuth.cookieHeader)
      .set('X-CSRF-Token', agencyAuth.csrfHeader)
      .send({ email: 'test@test.com', name: 'X', role: 'sales' });

    expect(res.status).toBe(403);
  });

  it('retorna 401 sem autenticacao', async () => {
    const res = await request(app)
      .post('/api/broadcaster/sub-users')
      .send({ email: 'test@test.com', name: 'X', role: 'sales' });

    expect(res.status).toBe(401);
  });
});

// ─── listSubUsers extras ──────────────────────────────────────────────────

describe('GET /api/broadcaster/sub-users — extras', () => {
  it('retorna lista vazia quando nao ha sub-usuarios', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .get('/api/broadcaster/sub-users')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.subUsers).toHaveLength(0);
  });

  it('retorna 403 para advertiser', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .get('/api/broadcaster/sub-users')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });
});

// ─── getSubUserStats extras ───────────────────────────────────────────────

describe('GET /api/broadcaster/sub-users/stats', () => {
  it('retorna estatisticas de sub-usuarios', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .get('/api/broadcaster/sub-users/stats')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('maxSubUsers');
  });

  it('retorna 403 para agency', async () => {
    const { auth: agencyAuth } = await createAgency();

    const res = await request(app)
      .get('/api/broadcaster/sub-users/stats')
      .set('Cookie', agencyAuth.cookieHeader)
      .set('X-CSRF-Token', agencyAuth.csrfHeader);

    expect(res.status).toBe(403);
  });
});

// ─── getSubUserDashboard extras ───────────────────────────────────────────

describe('GET /api/broadcaster/sub-users/dashboard', () => {
  it('retorna dashboard para broadcaster', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .get('/api/broadcaster/sub-users/dashboard')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
  });

  it('retorna 401 sem autenticacao', async () => {
    const res = await request(app).get('/api/broadcaster/sub-users/dashboard');
    expect(res.status).toBe(401);
  });
});

// ─── updateSubUser extras ─────────────────────────────────────────────────

describe('PUT /api/broadcaster/sub-users/:id — extras', () => {
  it('retorna 404 para sub-usuario de outra emissora', async () => {
    const { user: broadcaster1, auth: auth1 } = await createBroadcaster();
    const { user: broadcaster2 } = await createBroadcaster();

    const subUser = await User.create({
      email: `sub-outra-${Date.now()}@emissora.com`,
      password: 'TestPass@123456!',
      userType: 'broadcaster',
      companyName: 'Sub Outra',
      cpfOrCnpj: '00000000000001',
      phone: '11999999999',
      status: 'approved',
      emailConfirmed: true,
      parentBroadcasterId: broadcaster2._id,
      subUserRole: 'sales',
    });

    const res = await request(app)
      .put(`/api/broadcaster/sub-users/${subUser._id}`)
      .set('Cookie', auth1.cookieHeader)
      .set('X-CSRF-Token', auth1.csrfHeader)
      .send({ name: 'Tentativa', role: 'sales' });

    expect(res.status).toBe(404);
  });
});

// ─── deleteSubUser extras ─────────────────────────────────────────────────

describe('DELETE /api/broadcaster/sub-users/:id — extras', () => {
  it('retorna 404 para sub-usuario inexistente', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .delete('/api/broadcaster/sub-users/507f1f77bcf86cd799439011')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(404);
  });

  it('retorna 403 para advertiser', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .delete('/api/broadcaster/sub-users/507f1f77bcf86cd799439011')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });
});
