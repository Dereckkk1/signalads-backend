/**
 * Integration Tests — Sponsorships API
 *
 * GET    /api/sponsorships/my-sponsorships
 * POST   /api/sponsorships
 * PUT    /api/sponsorships/:id
 * DELETE /api/sponsorships/:id
 * GET    /api/sponsorships/marketplace
 */

import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';
import express from 'express';
import cookieParser from 'cookie-parser';
import hpp from 'hpp';

import { mongoSanitize, xssSanitize } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';
import sponsorshipRoutes from '../../routes/sponsorshipRoutes';

import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { createBroadcaster, createAdvertiser } from '../helpers/authHelper';
import { Sponsorship } from '../../models/Sponsorship';

function createTestApp(): Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(mongoSanitize);
  app.use(xssSanitize);
  app.use(hpp());
  app.use(csrfProtection);
  app.use('/api/sponsorships', sponsorshipRoutes);
  app.use((_req, res) => { res.status(404).json({ error: 'Rota não encontrada' }); });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.status || 500).json({ error: 'Erro interno do servidor' });
  });
  return app;
}

const VALID_SPONSORSHIP = {
  programName: 'Show da Manhã',
  timeRange: { start: '08:00', end: '10:00' },
  daysOfWeek: [1, 2, 3, 4, 5],
  insertions: [{ name: 'Citação', duration: 0, quantityPerDay: 2, requiresMaterial: false }],
  netPrice: 500,
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
// POST /api/sponsorships
// ---------------------------------------------------------------------------

describe('POST /api/sponsorships', () => {
  it('cria patrocinio como broadcaster', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/sponsorships')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send(VALID_SPONSORSHIP);

    expect(res.status).toBe(201);
    expect(res.body.sponsorship).toBeDefined();
    expect(res.body.sponsorship.programName).toBe('Show da Manhã');
    expect(res.body.sponsorship.netPrice).toBe(500);
    expect(res.body.sponsorship.pricePerMonth).toBeCloseTo(625);
  });

  it('rejeita sem programName', async () => {
    const { auth } = await createBroadcaster();

    const { programName, ...noName } = VALID_SPONSORSHIP;
    const res = await request(app)
      .post('/api/sponsorships')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send(noName);

    expect(res.status).toBe(400);
  });

  it('rejeita netPrice invalido', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/sponsorships')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ ...VALID_SPONSORSHIP, netPrice: -10 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/netPrice/i);
  });

  it('rejeita daysOfWeek invalido', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/sponsorships')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ ...VALID_SPONSORSHIP, daysOfWeek: [8] });

    expect(res.status).toBe(400);
  });

  it('rejeita advertiser (403)', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .post('/api/sponsorships')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send(VALID_SPONSORSHIP);

    expect(res.status).toBe(403);
  });

  it('rejeita sem autenticacao (401)', async () => {
    const res = await request(app)
      .post('/api/sponsorships')
      .send(VALID_SPONSORSHIP);

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/sponsorships/my-sponsorships
// ---------------------------------------------------------------------------

describe('GET /api/sponsorships/my-sponsorships', () => {
  it('lista patrocinios da emissora autenticada', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();

    await Sponsorship.create({ ...VALID_SPONSORSHIP, broadcasterId: broadcaster._id, pricePerMonth: 625 });

    const res = await request(app)
      .get('/api/sponsorships/my-sponsorships')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].programName).toBe('Show da Manhã');
  });

  it('nao retorna patrocinios de outra emissora', async () => {
    const { auth } = await createBroadcaster();
    const { user: outra } = await createBroadcaster();
    await Sponsorship.create({ ...VALID_SPONSORSHIP, broadcasterId: outra._id, pricePerMonth: 625 });

    const res = await request(app)
      .get('/api/sponsorships/my-sponsorships')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('retorna 403 para advertiser', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .get('/api/sponsorships/my-sponsorships')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });

  it('retorna 401 sem autenticacao', async () => {
    const res = await request(app).get('/api/sponsorships/my-sponsorships');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/sponsorships/:id
// ---------------------------------------------------------------------------

describe('PUT /api/sponsorships/:id', () => {
  it('atualiza programName e netPrice', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();
    const sp = await Sponsorship.create({ ...VALID_SPONSORSHIP, broadcasterId: broadcaster._id, pricePerMonth: 625 });

    const res = await request(app)
      .put(`/api/sponsorships/${sp._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ programName: 'Novo Nome', netPrice: 800 });

    expect(res.status).toBe(200);
    expect(res.body.sponsorship.programName).toBe('Novo Nome');
    expect(res.body.sponsorship.netPrice).toBe(800);
    expect(res.body.sponsorship.pricePerMonth).toBeCloseTo(1000);
  });

  it('retorna 404 para patrocinio de outra emissora', async () => {
    const { auth } = await createBroadcaster();
    const { user: outra } = await createBroadcaster();
    const sp = await Sponsorship.create({ ...VALID_SPONSORSHIP, broadcasterId: outra._id, pricePerMonth: 625 });

    const res = await request(app)
      .put(`/api/sponsorships/${sp._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ programName: 'Hack' });

    expect(res.status).toBe(404);
  });

  it('rejeita daysOfWeek invalido no update', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();
    const sp = await Sponsorship.create({ ...VALID_SPONSORSHIP, broadcasterId: broadcaster._id, pricePerMonth: 625 });

    const res = await request(app)
      .put(`/api/sponsorships/${sp._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ daysOfWeek: [7] });

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/sponsorships/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/sponsorships/:id', () => {
  it('deleta patrocinio da propria emissora', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();
    const sp = await Sponsorship.create({ ...VALID_SPONSORSHIP, broadcasterId: broadcaster._id, pricePerMonth: 625 });

    const res = await request(app)
      .delete(`/api/sponsorships/${sp._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    const still = await Sponsorship.findById(sp._id);
    expect(still).toBeNull();
  });

  it('retorna 404 para patrocinio de outra emissora', async () => {
    const { auth } = await createBroadcaster();
    const { user: outra } = await createBroadcaster();
    const sp = await Sponsorship.create({ ...VALID_SPONSORSHIP, broadcasterId: outra._id, pricePerMonth: 625 });

    const res = await request(app)
      .delete(`/api/sponsorships/${sp._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(404);
    const still = await Sponsorship.findById(sp._id);
    expect(still).not.toBeNull();
  });

  it('retorna 403 para advertiser', async () => {
    const { user: broadcaster } = await createBroadcaster();
    const sp = await Sponsorship.create({ ...VALID_SPONSORSHIP, broadcasterId: broadcaster._id, pricePerMonth: 625 });
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .delete(`/api/sponsorships/${sp._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// GET /api/sponsorships/marketplace (público)
// ---------------------------------------------------------------------------

describe('GET /api/sponsorships/marketplace', () => {
  it('retorna patrocinios ativos de emissoras aprovadas agrupados por broadcaster', async () => {
    const { user: broadcaster } = await createBroadcaster();
    await Sponsorship.create({ ...VALID_SPONSORSHIP, broadcasterId: broadcaster._id, pricePerMonth: 625, isActive: true });

    const res = await request(app).get('/api/sponsorships/marketplace');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty('sponsorships');
  });

  it('nao retorna patrocinios inativos', async () => {
    const { user: broadcaster } = await createBroadcaster();
    await Sponsorship.create({ ...VALID_SPONSORSHIP, broadcasterId: broadcaster._id, pricePerMonth: 625, isActive: false });

    const res = await request(app).get('/api/sponsorships/marketplace');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('filtra por busca de nome do programa', async () => {
    const { user: broadcaster } = await createBroadcaster();
    await Sponsorship.create({ ...VALID_SPONSORSHIP, programName: 'Show da Tarde', broadcasterId: broadcaster._id, pricePerMonth: 625, isActive: true });

    const res = await request(app).get('/api/sponsorships/marketplace?search=tarde');

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0].sponsorships[0].programName).toBe('Show da Tarde');
  });

  it('retorna vazio quando search nao encontra nada', async () => {
    const { user: broadcaster } = await createBroadcaster();
    await Sponsorship.create({ ...VALID_SPONSORSHIP, broadcasterId: broadcaster._id, pricePerMonth: 625, isActive: true });

    const res = await request(app).get('/api/sponsorships/marketplace?search=zzznaoexiste');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });
});
