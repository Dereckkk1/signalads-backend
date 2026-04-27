/**
 * Integration Tests — Broadcaster Reports API
 *
 * GET /api/broadcaster/reports/summary
 * GET /api/broadcaster/reports/breakdown?by=...
 * GET /api/broadcaster/reports/goals
 */

import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';
import express from 'express';
import cookieParser from 'cookie-parser';

import { mongoSanitize, xssSanitize, dedupeQuery } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';
import broadcasterReportsRoutes from '../../routes/broadcasterReportsRoutes';

import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { createBroadcaster, createAdvertiser } from '../helpers/authHelper';
import Proposal from '../../models/Proposal';

function createTestApp(): Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(mongoSanitize);
  app.use(xssSanitize);
  app.use(dedupeQuery);
  app.use(csrfProtection);
  app.use('/api/broadcaster', broadcasterReportsRoutes);
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
// GET /api/broadcaster/reports/summary
// ---------------------------------------------------------------------------

describe('GET /api/broadcaster/reports/summary', () => {
  it('retorna resumo com estrutura correta quando sem propostas', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .get('/api/broadcaster/reports/summary')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.summary).toBeDefined();
    expect(res.body.summary).toHaveProperty('total');
    expect(res.body.summary).toHaveProperty('approved');
    expect(res.body.summary).toHaveProperty('conversionRate');
    expect(res.body).toHaveProperty('topClients');
    expect(res.body).toHaveProperty('topSellers');
    expect(res.body).toHaveProperty('byMonth');
    expect(res.body).toHaveProperty('sellers');
  });

  it('agrega propostas aprovadas no resumo', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();

    await Proposal.create({
      broadcasterId: broadcaster._id,
      ownerType: 'broadcaster',
      proposalNumber: 'P-001',
      slug: `report-test-${Date.now()}`,
      title: 'Campanha 1',
      clientName: 'Cliente A',
      status: 'approved',
      totalAmount: 5000,
      grossAmount: 5000,
      items: [],
      respondedAt: new Date(),
    });

    const res = await request(app)
      .get('/api/broadcaster/reports/summary')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.summary.total).toBeGreaterThanOrEqual(1);
    expect(res.body.summary.approved).toBeGreaterThanOrEqual(1);
    expect(res.body.summary.approvedValue).toBeGreaterThanOrEqual(5000);
  });

  it('retorna 403 para advertiser', async () => {
    const { auth } = await createAdvertiser();
    const res = await request(app)
      .get('/api/broadcaster/reports/summary')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);
    expect(res.status).toBe(403);
  });

  it('retorna 401 sem autenticacao', async () => {
    const res = await request(app).get('/api/broadcaster/reports/summary');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/broadcaster/reports/breakdown
// ---------------------------------------------------------------------------

describe('GET /api/broadcaster/reports/breakdown', () => {
  it('retorna breakdown por cliente', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .get('/api/broadcaster/reports/breakdown?by=client')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.by).toBe('client');
    expect(Array.isArray(res.body.rows)).toBe(true);
  });

  it('retorna breakdown por vendedor', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .get('/api/broadcaster/reports/breakdown?by=seller')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.by).toBe('seller');
    expect(Array.isArray(res.body.rows)).toBe(true);
  });

  it('retorna breakdown por estagio', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .get('/api/broadcaster/reports/breakdown?by=stage')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.by).toBe('stage');
  });

  it('retorna 400 para dimensao nao suportada', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .get('/api/broadcaster/reports/breakdown?by=invalido')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/não suportada/i);
  });

  it('retorna 400 sem parametro by', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .get('/api/broadcaster/reports/breakdown')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/"by"/i);
  });

  it('retorna 403 para advertiser', async () => {
    const { auth } = await createAdvertiser();
    const res = await request(app)
      .get('/api/broadcaster/reports/breakdown?by=client')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);
    expect(res.status).toBe(403);
  });

  it('retorna breakdown por insertionType', async () => {
    const { auth } = await createBroadcaster();
    const res = await request(app)
      .get('/api/broadcaster/reports/breakdown?by=insertionType')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);
    expect(res.status).toBe(200);
    expect(res.body.by).toBe('insertionType');
    expect(Array.isArray(res.body.rows)).toBe(true);
  });

  it('retorna breakdown por clientType', async () => {
    const { auth } = await createBroadcaster();
    const res = await request(app)
      .get('/api/broadcaster/reports/breakdown?by=clientType')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);
    expect(res.status).toBe(200);
    expect(res.body.by).toBe('clientType');
  });

  it('retorna breakdown por proposalType', async () => {
    const { auth } = await createBroadcaster();
    const res = await request(app)
      .get('/api/broadcaster/reports/breakdown?by=proposalType')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);
    expect(res.status).toBe(200);
    expect(res.body.by).toBe('proposalType');
  });

  it('retorna breakdown por timeSlot', async () => {
    const { auth } = await createBroadcaster();
    const res = await request(app)
      .get('/api/broadcaster/reports/breakdown?by=timeSlot')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);
    expect(res.status).toBe(200);
    expect(res.body.by).toBe('timeSlot');
  });

  it('retorna breakdown por dayOfWeek', async () => {
    const { auth } = await createBroadcaster();
    const res = await request(app)
      .get('/api/broadcaster/reports/breakdown?by=dayOfWeek')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);
    expect(res.status).toBe(200);
    expect(res.body.by).toBe('dayOfWeek');
  });

  it('retorna breakdown por month', async () => {
    const { auth } = await createBroadcaster();
    const res = await request(app)
      .get('/api/broadcaster/reports/breakdown?by=month')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);
    expect(res.status).toBe(200);
    expect(res.body.by).toBe('month');
  });

  it('retorna breakdown por year', async () => {
    const { auth } = await createBroadcaster();
    const res = await request(app)
      .get('/api/broadcaster/reports/breakdown?by=year')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);
    expect(res.status).toBe(200);
    expect(res.body.by).toBe('year');
  });

  it('retorna breakdown por userType', async () => {
    const { auth } = await createBroadcaster();
    const res = await request(app)
      .get('/api/broadcaster/reports/breakdown?by=userType')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);
    expect(res.status).toBe(200);
    expect(res.body.by).toBe('userType');
  });

  it('retorna breakdown por validity', async () => {
    const { auth } = await createBroadcaster();
    const res = await request(app)
      .get('/api/broadcaster/reports/breakdown?by=validity')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);
    expect(res.status).toBe(200);
    expect(res.body.by).toBe('validity');
  });

  it('retorna breakdown por insertionTable', async () => {
    const { auth } = await createBroadcaster();
    const res = await request(app)
      .get('/api/broadcaster/reports/breakdown?by=insertionTable')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);
    expect(res.status).toBe(200);
    expect(res.body.by).toBe('insertionTable');
  });

  it('retorna breakdown por combo', async () => {
    const { auth } = await createBroadcaster();
    const res = await request(app)
      .get('/api/broadcaster/reports/breakdown?by=combo')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);
    expect(res.status).toBe(200);
    expect(res.body.by).toBe('combo');
  });

  it('aceita filtro por startDate e endDate', async () => {
    const { auth } = await createBroadcaster();
    const res = await request(app)
      .get('/api/broadcaster/reports/breakdown?by=client&startDate=2026-01-01&endDate=2026-12-31')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.rows)).toBe(true);
  });

  it('retorna array vazio quando nao ha dados no periodo', async () => {
    const { auth } = await createBroadcaster();
    const res = await request(app)
      .get('/api/broadcaster/reports/breakdown?by=client&startDate=2000-01-01&endDate=2000-01-02')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// GET /api/broadcaster/reports/goals
// ---------------------------------------------------------------------------

describe('GET /api/broadcaster/reports/goals', () => {
  it('retorna relatorio de metas com realizados', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .get('/api/broadcaster/reports/goals')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.goals).toBeDefined();
    expect(Array.isArray(res.body.goals)).toBe(true);
  });

  it('retorna 403 para advertiser', async () => {
    const { auth } = await createAdvertiser();
    const res = await request(app)
      .get('/api/broadcaster/reports/goals')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);
    expect(res.status).toBe(403);
  });

  it('retorna 401 sem autenticacao', async () => {
    const res = await request(app).get('/api/broadcaster/reports/goals');
    expect(res.status).toBe(401);
  });
});
