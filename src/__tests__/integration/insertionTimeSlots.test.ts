/**
 * Integration Tests — Insertion Time Slots API
 *
 * GET    /api/insertion-time-slots
 * POST   /api/insertion-time-slots
 * PUT    /api/insertion-time-slots/:id
 * DELETE /api/insertion-time-slots/:id
 */

import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';
import express from 'express';
import cookieParser from 'cookie-parser';
import hpp from 'hpp';

import { mongoSanitize, xssSanitize } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';
import insertionTimeSlotRoutes from '../../routes/insertionTimeSlotRoutes';

import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { createBroadcaster, createAdvertiser } from '../helpers/authHelper';
import { InsertionTimeSlot } from '../../models/InsertionTimeSlot';

function createTestApp(): Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(mongoSanitize);
  app.use(xssSanitize);
  app.use(hpp());
  app.use(csrfProtection);
  app.use('/api/insertion-time-slots', insertionTimeSlotRoutes);
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
// GET /api/insertion-time-slots
// ---------------------------------------------------------------------------

describe('GET /api/insertion-time-slots', () => {
  it('lista faixas da emissora autenticada', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();
    await InsertionTimeSlot.create({ broadcasterId: broadcaster._id, name: 'Manhã', type: 'rotativo' });

    const res = await request(app)
      .get('/api/insertion-time-slots')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Manhã');
  });

  it('nao retorna faixas de outra emissora', async () => {
    const { auth } = await createBroadcaster();
    const { user: outra } = await createBroadcaster();
    await InsertionTimeSlot.create({ broadcasterId: outra._id, name: 'Tarde', type: 'rotativo' });

    const res = await request(app)
      .get('/api/insertion-time-slots')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('retorna 403 para advertiser', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .get('/api/insertion-time-slots')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });

  it('retorna 401 sem autenticacao', async () => {
    const res = await request(app).get('/api/insertion-time-slots');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /api/insertion-time-slots
// ---------------------------------------------------------------------------

describe('POST /api/insertion-time-slots', () => {
  it('cria faixa rotativa', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/insertion-time-slots')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'Rotativo', type: 'rotativo' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Rotativo');
    expect(res.body.type).toBe('rotativo');
  });

  it('cria faixa determinada com horarios', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/insertion-time-slots')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'Manhã', type: 'determinado', start: '06:00', end: '12:00' });

    expect(res.status).toBe(201);
    expect(res.body.start).toBe('06:00');
    expect(res.body.end).toBe('12:00');
  });

  it('rejeita faixa determinada sem horarios', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/insertion-time-slots')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'Sem horario', type: 'determinado' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/início e fim/i);
  });

  it('rejeita sem nome', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/insertion-time-slots')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ type: 'rotativo' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/nome/i);
  });

  it('rejeita advertiser (403)', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .post('/api/insertion-time-slots')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'X', type: 'rotativo' });

    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/insertion-time-slots/:id
// ---------------------------------------------------------------------------

describe('PUT /api/insertion-time-slots/:id', () => {
  it('atualiza nome da faixa', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();
    const slot = await InsertionTimeSlot.create({ broadcasterId: broadcaster._id, name: 'Original', type: 'rotativo' });

    const res = await request(app)
      .put(`/api/insertion-time-slots/${slot._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'Atualizado' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Atualizado');
  });

  it('retorna 404 para faixa de outra emissora', async () => {
    const { auth } = await createBroadcaster();
    const { user: outra } = await createBroadcaster();
    const slot = await InsertionTimeSlot.create({ broadcasterId: outra._id, name: 'X', type: 'rotativo' });

    const res = await request(app)
      .put(`/api/insertion-time-slots/${slot._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'Hack' });

    expect(res.status).toBe(404);
  });

  it('rejeita nome vazio no update', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();
    const slot = await InsertionTimeSlot.create({ broadcasterId: broadcaster._id, name: 'Valido', type: 'rotativo' });

    const res = await request(app)
      .put(`/api/insertion-time-slots/${slot._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: '   ' });

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/insertion-time-slots/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/insertion-time-slots/:id', () => {
  it('deleta faixa da propria emissora', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();
    const slot = await InsertionTimeSlot.create({ broadcasterId: broadcaster._id, name: 'Deletar', type: 'rotativo' });

    const res = await request(app)
      .delete(`/api/insertion-time-slots/${slot._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/excluída/i);
    const still = await InsertionTimeSlot.findById(slot._id);
    expect(still).toBeNull();
  });

  it('retorna 404 para faixa de outra emissora', async () => {
    const { auth } = await createBroadcaster();
    const { user: outra } = await createBroadcaster();
    const slot = await InsertionTimeSlot.create({ broadcasterId: outra._id, name: 'X', type: 'rotativo' });

    const res = await request(app)
      .delete(`/api/insertion-time-slots/${slot._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(404);
  });

  it('retorna 403 para advertiser', async () => {
    const { user: broadcaster } = await createBroadcaster();
    const slot = await InsertionTimeSlot.create({ broadcasterId: broadcaster._id, name: 'X', type: 'rotativo' });
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .delete(`/api/insertion-time-slots/${slot._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });
});
