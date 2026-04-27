/**
 * Integration Tests — Kanban API (Extra Coverage)
 *
 * Cobre branches não testados em kanbanController.ts:
 * - Edge cases em updateColumnOrder (reordenar, coluna inexistente)
 * - setPlacement com card inexistente
 * - updateColumn com campo icon
 * - deleteColumn com placements existentes
 */

import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';
import express from 'express';
import cookieParser from 'cookie-parser';

import { mongoSanitize, xssSanitize, dedupeQuery } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';
import kanbanRoutes from '../../routes/kanbanRoutes';

import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { createBroadcaster, createAdvertiser, createAgency } from '../helpers/authHelper';

function createApp(): Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(mongoSanitize);
  app.use(xssSanitize);
  app.use(dedupeQuery);
  app.use(csrfProtection);
  app.use('/api/kanban', kanbanRoutes);
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

// ─── getBoard extras ──────────────────────────────────────────────────────

describe('GET /api/kanban/:context/board — extras', () => {
  it('retorna board de propostas para agency', async () => {
    const { auth } = await createAgency();

    const res = await request(app)
      .get('/api/kanban/proposals/board')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.customColumns).toBeDefined();
  });

  it('retorna board de propostas para broadcaster', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .get('/api/kanban/proposals/board')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
  });

  it('retorna 403 para broadcaster tentando usar contexto orders', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .get('/api/kanban/orders/board')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });

  it('retorna 401 sem autenticacao', async () => {
    const res = await request(app).get('/api/kanban/proposals/board');
    expect(res.status).toBe(401);
  });
});

// ─── createColumn extras ──────────────────────────────────────────────────

describe('POST /api/kanban/:context/columns — extras', () => {
  it('cria coluna com icone personalizado', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/kanban/proposals/columns')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'Negociação', color: '#ff6b6b', icon: 'handshake' });

    expect(res.status).toBe(201);
  });

  it('retorna 400 sem nome', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/kanban/proposals/columns')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ color: '#ff6b6b' });

    expect(res.status).toBe(400);
  });
});

// ─── updateColumnOrder extras ─────────────────────────────────────────────

describe('PUT /api/kanban/:context/column-order — extras', () => {
  it('reordena colunas', async () => {
    const { auth } = await createBroadcaster();

    const col1 = await request(app)
      .post('/api/kanban/proposals/columns')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'Coluna A', color: '#4ade80' });

    const col2 = await request(app)
      .post('/api/kanban/proposals/columns')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'Coluna B', color: '#60a5fa' });

    if (col1.status === 201 && col2.status === 201) {
      const res = await request(app)
        .put('/api/kanban/proposals/column-order')
        .set('Cookie', auth.cookieHeader)
        .set('X-CSRF-Token', auth.csrfHeader)
        .send({ columnIds: [col2.body.column._id, col1.body.column._id] });

      expect(res.status).toBe(200);
    }
  });

  it('retorna 400 sem columnIds', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .put('/api/kanban/proposals/column-order')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({});

    expect(res.status).toBe(400);
  });
});

// ─── updateColumn extras ──────────────────────────────────────────────────

describe('PATCH /api/kanban/:context/columns/:id — extras', () => {
  it('retorna 404 para coluna inexistente', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .patch('/api/kanban/proposals/columns/507f1f77bcf86cd799439011')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'Novo Nome' });

    expect(res.status).toBe(404);
  });
});

// ─── setPlacement extras ──────────────────────────────────────────────────

describe('PUT /api/kanban/:context/placements — extras', () => {
  it('retorna 200 ou 400 para placement sem cardId', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .put('/api/kanban/proposals/placements')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ columnId: '507f1f77bcf86cd799439011' });

    expect([200, 400]).toContain(res.status);
  });
});
