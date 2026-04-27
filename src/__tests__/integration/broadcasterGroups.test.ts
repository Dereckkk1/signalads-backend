/**
 * Integration Tests — Broadcaster Groups API
 *
 * GET    /api/broadcaster/groups
 * POST   /api/broadcaster/groups
 * PUT    /api/broadcaster/groups/:id
 * DELETE /api/broadcaster/groups/:id
 */

import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';
import express from 'express';
import cookieParser from 'cookie-parser';

import { mongoSanitize, xssSanitize, dedupeQuery } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';
import broadcasterGroupRoutes from '../../routes/broadcasterGroupRoutes';

import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { createBroadcaster, createAdvertiser } from '../helpers/authHelper';
import BroadcasterGroup from '../../models/BroadcasterGroup';

function createTestApp(): Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(mongoSanitize);
  app.use(xssSanitize);
  app.use(dedupeQuery);
  app.use(csrfProtection);
  app.use('/api/broadcaster', broadcasterGroupRoutes);
  app.use((_req, res) => { res.status(404).json({ error: 'Rota não encontrada' }); });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.status || 500).json({ error: 'Erro interno do servidor' });
  });
  return app;
}

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
// GET /api/broadcaster/groups
// ---------------------------------------------------------------------------

describe('GET /api/broadcaster/groups', () => {
  it('lista grupos da emissora com memberCount', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();
    await BroadcasterGroup.create({ broadcasterId: broadcaster._id, name: 'Comercial', permissions: [] });

    const res = await request(app)
      .get('/api/broadcaster/groups')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.groups).toBeDefined();
    expect(res.body.groups).toHaveLength(1);
    expect(res.body.groups[0].name).toBe('Comercial');
    expect(res.body.groups[0]).toHaveProperty('memberCount');
  });

  it('nao retorna grupos de outra emissora', async () => {
    const { auth } = await createBroadcaster();
    const { user: outra } = await createBroadcaster();
    await BroadcasterGroup.create({ broadcasterId: outra._id, name: 'Outro Grupo', permissions: [] });

    const res = await request(app)
      .get('/api/broadcaster/groups')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.groups).toHaveLength(0);
  });

  it('retorna 403 para advertiser', async () => {
    const { auth } = await createAdvertiser();
    const res = await request(app)
      .get('/api/broadcaster/groups')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);
    expect(res.status).toBe(403);
  });

  it('retorna 401 sem autenticacao', async () => {
    const res = await request(app).get('/api/broadcaster/groups');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /api/broadcaster/groups
// ---------------------------------------------------------------------------

describe('POST /api/broadcaster/groups', () => {
  it('cria grupo com nome e permissoes', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/broadcaster/groups')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'Vendas', permissions: ['proposals', 'clients'] });

    expect(res.status).toBe(201);
    expect(res.body.group.name).toBe('Vendas');
    expect(res.body.group.memberCount).toBe(0);
  });

  it('rejeita nome duplicado na mesma emissora', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();
    await BroadcasterGroup.create({ broadcasterId: broadcaster._id, name: 'Duplicado', permissions: [] });

    const res = await request(app)
      .post('/api/broadcaster/groups')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'Duplicado' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/já existe/i);
  });

  it('rejeita nome vazio', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/broadcaster/groups')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: '' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/nome/i);
  });

  it('retorna 403 para advertiser', async () => {
    const { auth } = await createAdvertiser();
    const res = await request(app)
      .post('/api/broadcaster/groups')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'X' });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/broadcaster/groups/:id
// ---------------------------------------------------------------------------

describe('PUT /api/broadcaster/groups/:id', () => {
  it('atualiza nome do grupo', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();
    const group = await BroadcasterGroup.create({ broadcasterId: broadcaster._id, name: 'Original', permissions: [] });

    const res = await request(app)
      .put(`/api/broadcaster/groups/${group._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'Atualizado' });

    expect(res.status).toBe(200);
    expect(res.body.group.name).toBe('Atualizado');
  });

  it('retorna 404 para grupo de outra emissora', async () => {
    const { auth } = await createBroadcaster();
    const { user: outra } = await createBroadcaster();
    const group = await BroadcasterGroup.create({ broadcasterId: outra._id, name: 'Alheio', permissions: [] });

    const res = await request(app)
      .put(`/api/broadcaster/groups/${group._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'Hack' });

    expect(res.status).toBe(404);
  });

  it('rejeita nome duplicado no update', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();
    await BroadcasterGroup.create({ broadcasterId: broadcaster._id, name: 'Existente', permissions: [] });
    const group = await BroadcasterGroup.create({ broadcasterId: broadcaster._id, name: 'Outro', permissions: [] });

    const res = await request(app)
      .put(`/api/broadcaster/groups/${group._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'Existente' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/já existe/i);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/broadcaster/groups/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/broadcaster/groups/:id', () => {
  it('remove grupo da propria emissora', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();
    const group = await BroadcasterGroup.create({ broadcasterId: broadcaster._id, name: 'Deletar', permissions: [] });

    const res = await request(app)
      .delete(`/api/broadcaster/groups/${group._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/removido/i);
    const still = await BroadcasterGroup.findById(group._id);
    expect(still).toBeNull();
  });

  it('retorna 404 para grupo de outra emissora', async () => {
    const { auth } = await createBroadcaster();
    const { user: outra } = await createBroadcaster();
    const group = await BroadcasterGroup.create({ broadcasterId: outra._id, name: 'X', permissions: [] });

    const res = await request(app)
      .delete(`/api/broadcaster/groups/${group._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(404);
  });

  it('retorna 403 para advertiser', async () => {
    const { user: broadcaster } = await createBroadcaster();
    const group = await BroadcasterGroup.create({ broadcasterId: broadcaster._id, name: 'X', permissions: [] });
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .delete(`/api/broadcaster/groups/${group._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });
});
