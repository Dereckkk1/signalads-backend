/**
 * Integration Tests — Broadcaster Goals API
 *
 * GET    /api/broadcaster/goals
 * GET    /api/broadcaster/goals/analytics
 * POST   /api/broadcaster/goals
 * PUT    /api/broadcaster/goals/:id
 * DELETE /api/broadcaster/goals/:id
 */

import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';
import express from 'express';
import cookieParser from 'cookie-parser';
import hpp from 'hpp';

import { mongoSanitize, xssSanitize } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';
import broadcasterGoalsRoutes from '../../routes/broadcasterGoalsRoutes';

import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { createBroadcaster, createAdvertiser } from '../helpers/authHelper';
import Goal from '../../models/Goal';

function createTestApp(): Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(mongoSanitize);
  app.use(xssSanitize);
  app.use(hpp());
  app.use(csrfProtection);
  app.use('/api/broadcaster', broadcasterGoalsRoutes);
  app.use((_req, res) => { res.status(404).json({ error: 'Rota não encontrada' }); });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.status || 500).json({ error: 'Erro interno do servidor' });
  });
  return app;
}

const VALID_GOAL = {
  type: 'general',
  targetValue: 10000,
  startDate: '2026-01-01',
  endDate: '2026-03-31',
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
// GET /api/broadcaster/goals
// ---------------------------------------------------------------------------

describe('GET /api/broadcaster/goals', () => {
  it('lista metas da emissora com realizado calculado', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();

    await Goal.create({
      broadcasterOwnerId: broadcaster._id,
      ...VALID_GOAL,
    });

    const res = await request(app)
      .get('/api/broadcaster/goals')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.goals).toBeDefined();
    expect(res.body.goals).toHaveLength(1);
    expect(res.body.goals[0].targetValue).toBe(10000);
    expect(res.body.goals[0]).toHaveProperty('realizado');
    expect(res.body.goals[0]).toHaveProperty('percentual');
  });

  it('nao retorna metas de outra emissora', async () => {
    const { auth } = await createBroadcaster();
    const { user: outra } = await createBroadcaster();

    await Goal.create({ broadcasterOwnerId: outra._id, ...VALID_GOAL });

    const res = await request(app)
      .get('/api/broadcaster/goals')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.goals).toHaveLength(0);
  });

  it('retorna 403 para advertiser', async () => {
    const { auth } = await createAdvertiser();
    const res = await request(app)
      .get('/api/broadcaster/goals')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);
    expect(res.status).toBe(403);
  });

  it('retorna 401 sem autenticacao', async () => {
    const res = await request(app).get('/api/broadcaster/goals');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/broadcaster/goals/analytics
// ---------------------------------------------------------------------------

describe('GET /api/broadcaster/goals/analytics', () => {
  it('retorna analytics com total, monthly, bySeller', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .get('/api/broadcaster/goals/analytics?startDate=2026-01-01&endDate=2026-12-31')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('monthly');
    expect(res.body).toHaveProperty('bySeller');
  });

  it('retorna 400 sem startDate e endDate', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .get('/api/broadcaster/goals/analytics')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/startDate e endDate/i);
  });

  it('retorna 403 para advertiser', async () => {
    const { auth } = await createAdvertiser();
    const res = await request(app)
      .get('/api/broadcaster/goals/analytics?startDate=2026-01-01&endDate=2026-12-31')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST /api/broadcaster/goals
// ---------------------------------------------------------------------------

describe('POST /api/broadcaster/goals', () => {
  it('cria meta geral', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/broadcaster/goals')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send(VALID_GOAL);

    expect(res.status).toBe(201);
    expect(res.body.goal).toBeDefined();
    expect(res.body.goal.targetValue).toBe(10000);
    expect(res.body.goal.type).toBe('general');
  });

  it('rejeita tipo invalido', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/broadcaster/goals')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ ...VALID_GOAL, type: 'unknown' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/tipo inválido/i);
  });

  it('rejeita meta individual sem sellerId', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/broadcaster/goals')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ ...VALID_GOAL, type: 'individual' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/vendedor/i);
  });

  it('rejeita targetValue zero ou negativo', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/broadcaster/goals')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ ...VALID_GOAL, targetValue: 0 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/maior que zero/i);
  });

  it('rejeita quando startDate >= endDate', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/broadcaster/goals')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ ...VALID_GOAL, startDate: '2026-03-31', endDate: '2026-01-01' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/início deve ser anterior/i);
  });

  it('retorna 403 para advertiser', async () => {
    const { auth } = await createAdvertiser();
    const res = await request(app)
      .post('/api/broadcaster/goals')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send(VALID_GOAL);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/broadcaster/goals/:id
// ---------------------------------------------------------------------------

describe('PUT /api/broadcaster/goals/:id', () => {
  it('atualiza targetValue da meta', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();
    const goal = await Goal.create({ broadcasterOwnerId: broadcaster._id, ...VALID_GOAL });

    const res = await request(app)
      .put(`/api/broadcaster/goals/${goal._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ targetValue: 20000 });

    expect(res.status).toBe(200);
    expect(res.body.goal.targetValue).toBe(20000);
  });

  it('retorna 404 para meta de outra emissora', async () => {
    const { auth } = await createBroadcaster();
    const { user: outra } = await createBroadcaster();
    const goal = await Goal.create({ broadcasterOwnerId: outra._id, ...VALID_GOAL });

    const res = await request(app)
      .put(`/api/broadcaster/goals/${goal._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ targetValue: 999 });

    expect(res.status).toBe(404);
  });

  it('rejeita targetValue invalido no update', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();
    const goal = await Goal.create({ broadcasterOwnerId: broadcaster._id, ...VALID_GOAL });

    const res = await request(app)
      .put(`/api/broadcaster/goals/${goal._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ targetValue: -100 });

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/broadcaster/goals/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/broadcaster/goals/:id', () => {
  it('remove meta da propria emissora', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();
    const goal = await Goal.create({ broadcasterOwnerId: broadcaster._id, ...VALID_GOAL });

    const res = await request(app)
      .delete(`/api/broadcaster/goals/${goal._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/removida/i);
    const still = await Goal.findById(goal._id);
    expect(still).toBeNull();
  });

  it('retorna 404 para meta de outra emissora', async () => {
    const { auth } = await createBroadcaster();
    const { user: outra } = await createBroadcaster();
    const goal = await Goal.create({ broadcasterOwnerId: outra._id, ...VALID_GOAL });

    const res = await request(app)
      .delete(`/api/broadcaster/goals/${goal._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(404);
  });

  it('retorna 403 para advertiser', async () => {
    const { user: broadcaster } = await createBroadcaster();
    const goal = await Goal.create({ broadcasterOwnerId: broadcaster._id, ...VALID_GOAL });
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .delete(`/api/broadcaster/goals/${goal._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });
});
