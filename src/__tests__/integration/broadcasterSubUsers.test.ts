/**
 * Integration Tests — Broadcaster Sub-Users API
 *
 * GET    /api/broadcaster/sub-users
 * GET    /api/broadcaster/sub-users/stats
 * GET    /api/broadcaster/sub-users/dashboard
 * POST   /api/broadcaster/sub-users
 * PUT    /api/broadcaster/sub-users/:id
 * DELETE /api/broadcaster/sub-users/:id
 * POST   /api/broadcaster/sub-users/:id/resend-invite
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
import { createBroadcaster, createAdvertiser } from '../helpers/authHelper';
import { User } from '../../models/User';

function createTestApp(): Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(mongoSanitize);
  app.use(xssSanitize);
  app.use(dedupeQuery);
  app.use(csrfProtection);
  app.use('/api/broadcaster', broadcasterSubUserRoutes);
  app.use((_req, res) => { res.status(404).json({ error: 'Rota não encontrada' }); });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.status || 500).json({ error: 'Erro interno do servidor' });
  });
  return app;
}

const SUB_USER_PAYLOAD = {
  name: 'Vendedor Teste',
  email: `vendedor-${Date.now()}@emissora.com.br`,
  phone: '11999999999',
  cpfOrCnpj: '12345678901',
};

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

// ---------------------------------------------------------------------------
// GET /api/broadcaster/sub-users
// ---------------------------------------------------------------------------

describe('GET /api/broadcaster/sub-users', () => {
  it('lista sub-usuarios da emissora', async () => {
    const { user: manager, auth } = await createBroadcaster();
    await User.create({
      name: 'Vendedor A',
      email: 'vendedor-a@emissora.com.br',
      password: 'hashedpassword12',
      phone: '11999999999',
      cpfOrCnpj: '12345678901234',
      userType: 'broadcaster',
      broadcasterRole: 'sales',
      parentBroadcasterId: manager._id,
      status: 'approved',
      emailConfirmed: true,
    });

    const res = await request(app)
      .get('/api/broadcaster/sub-users')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.subUsers).toHaveLength(1);
    expect(res.body.subUsers[0].name).toBe('Vendedor A');
    expect(res.body.maxSubUsers).toBe(3);
  });

  it('nao retorna sub-usuarios de outra emissora', async () => {
    const { auth } = await createBroadcaster();
    const { user: outra } = await createBroadcaster();
    await User.create({
      name: 'Sub Alheio',
      email: 'sub-alheio@emissora.com.br',
      password: 'hashedpassword12',
      phone: '11999999999',
      cpfOrCnpj: '12345678901234',
      userType: 'broadcaster',
      broadcasterRole: 'sales',
      parentBroadcasterId: outra._id,
      status: 'approved',
      emailConfirmed: true,
    });

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

  it('retorna 401 sem autenticacao', async () => {
    const res = await request(app).get('/api/broadcaster/sub-users');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /api/broadcaster/sub-users
// ---------------------------------------------------------------------------

describe('POST /api/broadcaster/sub-users', () => {
  it('cria sub-usuario com email de convite enviado', async () => {
    const { auth } = await createBroadcaster();
    const payload = { ...SUB_USER_PAYLOAD, email: `vendedor-novo-${Date.now()}@emissora.com.br` };

    const res = await request(app)
      .post('/api/broadcaster/sub-users')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body.subUser.name).toBe(payload.name);
    expect(res.body.subUser.email).toBe(payload.email);
  });

  it('rejeita email ja em uso', async () => {
    const { auth } = await createBroadcaster();
    const { user: existing } = await createBroadcaster();

    const res = await request(app)
      .post('/api/broadcaster/sub-users')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ ...SUB_USER_PAYLOAD, email: existing.email });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });

  it('rejeita sem nome', async () => {
    const { auth } = await createBroadcaster();

    const { name, ...noName } = SUB_USER_PAYLOAD;
    const res = await request(app)
      .post('/api/broadcaster/sub-users')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ ...noName, email: `sem-nome-${Date.now()}@emissora.com.br` });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/nome/i);
  });

  it('rejeita quando limite default de 3 sub-usuarios atingido', async () => {
    const { user: manager, auth } = await createBroadcaster();

    // Criar 3 sub-usuarios
    for (let i = 0; i < 3; i++) {
      await User.create({
        name: `Vendedor ${i}`,
        email: `vendedor-limite-${i}-${Date.now()}@emissora.com.br`,
        password: 'hashedpassword12',
      phone: '11999999999',
      cpfOrCnpj: '12345678901234',
        userType: 'broadcaster',
        broadcasterRole: 'sales',
        parentBroadcasterId: manager._id,
        status: 'approved',
        emailConfirmed: true,
      });
    }

    const res = await request(app)
      .post('/api/broadcaster/sub-users')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ ...SUB_USER_PAYLOAD, email: `extra-${Date.now()}@emissora.com.br` });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/limite/i);
    expect(res.body.error).toMatch(/3/);
  });

  it('respeita maxSubUsers customizado (admin define 5, permite criar 5)', async () => {
    const { user: manager, auth } = await createBroadcaster();
    // Admin definiu limite custom de 5 para esta emissora
    await User.findByIdAndUpdate(manager._id, { maxSubUsers: 5 });

    // Cria 4 sub-usuarios — deve permitir um quinto
    for (let i = 0; i < 4; i++) {
      await User.create({
        name: `Vendedor ${i}`,
        email: `custom-limite-${i}-${Date.now()}@emissora.com.br`,
        password: 'hashedpassword12',
        phone: '11999999999',
        cpfOrCnpj: '12345678901234',
        userType: 'broadcaster',
        broadcasterRole: 'sales',
        parentBroadcasterId: manager._id,
        status: 'approved',
        emailConfirmed: true,
      });
    }

    const res = await request(app)
      .post('/api/broadcaster/sub-users')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ ...SUB_USER_PAYLOAD, email: `quinto-${Date.now()}@emissora.com.br` });

    expect(res.status).toBe(201);
  });

  it('respeita maxSubUsers customizado para baixo (admin define 1, bloqueia segundo)', async () => {
    const { user: manager, auth } = await createBroadcaster();
    await User.findByIdAndUpdate(manager._id, { maxSubUsers: 1 });

    await User.create({
      name: 'Unico Vendedor',
      email: `unico-${Date.now()}@emissora.com.br`,
      password: 'hashedpassword12',
      phone: '11999999999',
      cpfOrCnpj: '12345678901234',
      userType: 'broadcaster',
      broadcasterRole: 'sales',
      parentBroadcasterId: manager._id,
      status: 'approved',
      emailConfirmed: true,
    });

    const res = await request(app)
      .post('/api/broadcaster/sub-users')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ ...SUB_USER_PAYLOAD, email: `segundo-${Date.now()}@emissora.com.br` });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/limite de 1/i);
  });

  it('listagem retorna maxSubUsers customizado quando admin define', async () => {
    const { user: manager, auth } = await createBroadcaster();
    await User.findByIdAndUpdate(manager._id, { maxSubUsers: 7 });

    const res = await request(app)
      .get('/api/broadcaster/sub-users')
      .set('Cookie', auth.cookieHeader);

    expect(res.status).toBe(200);
    expect(res.body.maxSubUsers).toBe(7);
  });

  it('retorna 403 para advertiser', async () => {
    const { auth } = await createAdvertiser();
    const res = await request(app)
      .post('/api/broadcaster/sub-users')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send(SUB_USER_PAYLOAD);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/broadcaster/sub-users/:id
// ---------------------------------------------------------------------------

describe('PUT /api/broadcaster/sub-users/:id', () => {
  it('atualiza nome do sub-usuario', async () => {
    const { user: manager, auth } = await createBroadcaster();
    const subUser = await User.create({
      name: 'Antigo Nome',
      email: `sub-update-${Date.now()}@emissora.com.br`,
      password: 'hashedpassword12',
      phone: '11999999999',
      cpfOrCnpj: '12345678901234',
      userType: 'broadcaster',
      broadcasterRole: 'sales',
      parentBroadcasterId: manager._id,
      status: 'approved',
      emailConfirmed: true,
    });

    const res = await request(app)
      .put(`/api/broadcaster/sub-users/${subUser._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'Novo Nome' });

    expect(res.status).toBe(200);
    expect(res.body.subUser.name).toBe('Novo Nome');
  });

  it('retorna 404 para sub-usuario de outra emissora', async () => {
    const { auth } = await createBroadcaster();
    const { user: outra } = await createBroadcaster();
    const subUser = await User.create({
      name: 'Sub Alheio',
      email: `sub-alheio-${Date.now()}@emissora.com.br`,
      password: 'hashedpassword12',
      phone: '11999999999',
      cpfOrCnpj: '12345678901234',
      userType: 'broadcaster',
      broadcasterRole: 'sales',
      parentBroadcasterId: outra._id,
      status: 'approved',
      emailConfirmed: true,
    });

    const res = await request(app)
      .put(`/api/broadcaster/sub-users/${subUser._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'Hack' });

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/broadcaster/sub-users/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/broadcaster/sub-users/:id', () => {
  it('remove sub-usuario da propria emissora', async () => {
    const { user: manager, auth } = await createBroadcaster();
    const subUser = await User.create({
      name: 'Para Deletar',
      email: `sub-del-${Date.now()}@emissora.com.br`,
      password: 'hashedpassword12',
      phone: '11999999999',
      cpfOrCnpj: '12345678901234',
      userType: 'broadcaster',
      broadcasterRole: 'sales',
      parentBroadcasterId: manager._id,
      status: 'approved',
      emailConfirmed: true,
    });

    const res = await request(app)
      .delete(`/api/broadcaster/sub-users/${subUser._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/removido/i);
    const still = await User.findById(subUser._id);
    expect(still).toBeNull();
  });

  it('retorna 404 para sub-usuario de outra emissora', async () => {
    const { auth } = await createBroadcaster();
    const { user: outra } = await createBroadcaster();
    const subUser = await User.create({
      name: 'Alheio',
      email: `sub-alheio-del-${Date.now()}@emissora.com.br`,
      password: 'hashedpassword12',
      phone: '11999999999',
      cpfOrCnpj: '12345678901234',
      userType: 'broadcaster',
      broadcasterRole: 'sales',
      parentBroadcasterId: outra._id,
      status: 'approved',
      emailConfirmed: true,
    });

    const res = await request(app)
      .delete(`/api/broadcaster/sub-users/${subUser._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/broadcaster/sub-users/:id/resend-invite
// ---------------------------------------------------------------------------

describe('POST /api/broadcaster/sub-users/:id/resend-invite', () => {
  it('reenvia convite e atualiza token', async () => {
    const { user: manager, auth } = await createBroadcaster();
    const subUser = await User.create({
      name: 'Vendedor Convite',
      email: `sub-invite-${Date.now()}@emissora.com.br`,
      password: 'hashedpassword12',
      phone: '11999999999',
      cpfOrCnpj: '12345678901234',
      userType: 'broadcaster',
      broadcasterRole: 'sales',
      parentBroadcasterId: manager._id,
      status: 'approved',
      emailConfirmed: true,
      passwordResetToken: 'old-token',
    });

    const res = await request(app)
      .post(`/api/broadcaster/sub-users/${subUser._id}/resend-invite`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/reenviado/i);

    const updated = await User.findById(subUser._id);
    expect(updated?.passwordResetToken).not.toBe('old-token');
  });

  it('retorna 404 para sub-usuario de outra emissora', async () => {
    const { auth } = await createBroadcaster();
    const { user: outra } = await createBroadcaster();
    const subUser = await User.create({
      name: 'Alheio Invite',
      email: `sub-alheio-inv-${Date.now()}@emissora.com.br`,
      password: 'hashedpassword12',
      phone: '11999999999',
      cpfOrCnpj: '12345678901234',
      userType: 'broadcaster',
      broadcasterRole: 'sales',
      parentBroadcasterId: outra._id,
      status: 'approved',
      emailConfirmed: true,
    });

    const res = await request(app)
      .post(`/api/broadcaster/sub-users/${subUser._id}/resend-invite`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /api/broadcaster/sub-users/stats
// ---------------------------------------------------------------------------

describe('GET /api/broadcaster/sub-users/stats', () => {
  it('retorna stats com maxSubUsers quando sem sub-usuarios', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .get('/api/broadcaster/sub-users/stats')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.subUsers).toEqual([]);
    expect(res.body.maxSubUsers).toBe(3);
    expect(res.body.teamTotals).toBeDefined();
  });

  it('retorna 403 para advertiser', async () => {
    const { auth } = await createAdvertiser();
    const res = await request(app)
      .get('/api/broadcaster/sub-users/stats')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// GET /api/broadcaster/sub-users/dashboard
// ---------------------------------------------------------------------------

describe('GET /api/broadcaster/sub-users/dashboard', () => {
  it('retorna dashboard com summary, bySeller e byMonth', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .get('/api/broadcaster/sub-users/dashboard')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('summary');
    expect(res.body).toHaveProperty('bySeller');
    expect(res.body).toHaveProperty('byMonth');
    expect(res.body).toHaveProperty('proposals');
    expect(res.body).toHaveProperty('subUsers');
  });

  it('retorna 403 para advertiser', async () => {
    const { auth } = await createAdvertiser();
    const res = await request(app)
      .get('/api/broadcaster/sub-users/dashboard')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);
    expect(res.status).toBe(403);
  });
});
