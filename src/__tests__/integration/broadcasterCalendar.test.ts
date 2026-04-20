/**
 * Integration Tests — Broadcaster Calendar API
 *
 * GET /api/broadcaster/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD
 */

import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';
import express from 'express';
import cookieParser from 'cookie-parser';
import hpp from 'hpp';

import { mongoSanitize, xssSanitize } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';
import broadcasterCalendarRoutes from '../../routes/broadcasterCalendarRoutes';

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
  app.use('/api/broadcaster', broadcasterCalendarRoutes);
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

const START = '2026-04-01';
const END   = '2026-04-30';

describe('GET /api/broadcaster/calendar', () => {
  it('retorna eventos, dateSummary e totalEvents para broadcaster', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .get(`/api/broadcaster/calendar?start=${START}&end=${END}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('events');
    expect(res.body).toHaveProperty('dateSummary');
    expect(res.body).toHaveProperty('totalEvents');
    expect(Array.isArray(res.body.events)).toBe(true);
  });

  it('inclui patrocinios ativos como eventos recorrentes', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();

    // Segunda a sexta (1-5), abril de 2026
    await Sponsorship.create({
      broadcasterId: broadcaster._id,
      programName: 'Show da Manhã',
      timeRange: { start: '08:00', end: '10:00' },
      daysOfWeek: [1, 2, 3, 4, 5],
      insertions: [{ name: 'Citação', duration: 0, quantityPerDay: 2, requiresMaterial: false }],
      netPrice: 500,
      pricePerMonth: 625,
      isActive: true,
    });

    const res = await request(app)
      .get(`/api/broadcaster/calendar?start=${START}&end=${END}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    const sponsorshipEvents = res.body.events.filter((e: any) => e.type === 'patrocinio');
    expect(sponsorshipEvents.length).toBeGreaterThan(0);
    expect(sponsorshipEvents[0].title).toBe('Show da Manhã');
  });

  it('retorna 400 quando start ou end estao ausentes', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .get('/api/broadcaster/calendar')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/start e end/i);
  });

  it('retorna 403 para advertiser', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .get(`/api/broadcaster/calendar?start=${START}&end=${END}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });

  it('retorna 401 sem autenticacao', async () => {
    const res = await request(app).get(`/api/broadcaster/calendar?start=${START}&end=${END}`);
    expect(res.status).toBe(401);
  });
});
