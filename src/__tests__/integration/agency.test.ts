/**
 * Integration Tests — Agency API
 *
 * Tests real HTTP endpoints end-to-end.
 * GET    /api/agency/dashboard
 * GET    /api/agency/clients
 * POST   /api/agency/clients
 * PUT    /api/agency/clients/:id
 * DELETE /api/agency/clients/:id
 */

import '../helpers/mocks';

import request from 'supertest';
import express, { Application, Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import hpp from 'hpp';
import mongoose from 'mongoose';

import { mongoSanitize, xssSanitize } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';
import agencyRoutes from '../../routes/agencyRoutes';
import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import {
  createAgency,
  createAdvertiser,
  createAdmin,
} from '../helpers/authHelper';
import AgencyClient from '../../models/AgencyClient';

function createApp(): Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(mongoSanitize);
  app.use(xssSanitize);
  app.use(hpp());
  app.use(csrfProtection);
  app.use('/api/agency', agencyRoutes);
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Rota não encontrada' });
  });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.status || 500).json({ error: 'Erro interno do servidor' });
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

// ─────────────────────────────────────────────────
// GET /api/agency/clients
// ─────────────────────────────────────────────────
describe('GET /api/agency/clients', () => {
  it('should return empty list for agency with no clients', async () => {
    const { auth } = await createAgency();

    const res = await request(app)
      .get('/api/agency/clients')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('should return clients for the agency', async () => {
    const { user: agency, auth } = await createAgency();

    await AgencyClient.create({
      agencyId: agency._id,
      name: 'Cliente ABC',
      documentNumber: '12345678000100',
      email: 'abc@test.com',
      status: 'active',
    });

    const res = await request(app)
      .get('/api/agency/clients')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Cliente ABC');
  });

  it('should return 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/agency/clients');
    expect(res.status).toBe(401);
  });

  it('should return 403 for non-agency user', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .get('/api/agency/clients')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────
// POST /api/agency/clients
// ─────────────────────────────────────────────────
describe('POST /api/agency/clients', () => {
  it('should create a new client', async () => {
    const { auth } = await createAgency();

    const res = await request(app)
      .post('/api/agency/clients')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        name: 'Novo Cliente',
        documentNumber: '98765432000199',
        email: 'novo@cliente.com',
        phone: '11999999999',
      });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Novo Cliente');
    expect(res.body.documentNumber).toBe('98765432000199');
    expect(res.body.status).toBe('active');
  });

  it('should reject when name is missing', async () => {
    const { auth } = await createAgency();

    const res = await request(app)
      .post('/api/agency/clients')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ documentNumber: '12345678000100' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/obrigatórios/i);
  });

  it('should reject when documentNumber is missing', async () => {
    const { auth } = await createAgency();

    const res = await request(app)
      .post('/api/agency/clients')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'Test' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/obrigatórios/i);
  });

  it('should reject duplicate documentNumber for same agency', async () => {
    const { user: agency, auth } = await createAgency();

    await AgencyClient.create({
      agencyId: agency._id,
      name: 'Existing',
      documentNumber: '12345678000100',
      status: 'active',
    });

    const res = await request(app)
      .post('/api/agency/clients')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        name: 'Duplicate',
        documentNumber: '12345678000100',
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/já existe/i);
  });

  it('should return 403 for non-agency user', async () => {
    const { auth } = await createAdmin();

    const res = await request(app)
      .post('/api/agency/clients')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'Test', documentNumber: '12345678000100' });

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────
// PUT /api/agency/clients/:id
// ─────────────────────────────────────────────────
describe('PUT /api/agency/clients/:id', () => {
  it('should update client fields', async () => {
    const { user: agency, auth } = await createAgency();

    const client = await AgencyClient.create({
      agencyId: agency._id,
      name: 'Original',
      documentNumber: '12345678000100',
      status: 'active',
    });

    const res = await request(app)
      .put(`/api/agency/clients/${client._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'Updated Name', phone: '11888888888' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Name');
    expect(res.body.phone).toBe('11888888888');
  });

  it('should return 404 for client belonging to another agency', async () => {
    const { auth } = await createAgency();
    const { user: otherAgency } = await createAgency();

    const client = await AgencyClient.create({
      agencyId: otherAgency._id,
      name: 'Other Client',
      documentNumber: '99999999000100',
      status: 'active',
    });

    const res = await request(app)
      .put(`/api/agency/clients/${client._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'Hacked' });

    expect(res.status).toBe(404);
  });

  it('should return 404 for non-existent client', async () => {
    const { auth } = await createAgency();
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .put(`/api/agency/clients/${fakeId}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'Ghost' });

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────
// DELETE /api/agency/clients/:id
// ─────────────────────────────────────────────────
describe('DELETE /api/agency/clients/:id', () => {
  it('should delete a client', async () => {
    const { user: agency, auth } = await createAgency();

    const client = await AgencyClient.create({
      agencyId: agency._id,
      name: 'To Delete',
      documentNumber: '55555555000100',
      status: 'active',
    });

    const res = await request(app)
      .delete(`/api/agency/clients/${client._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/removido/i);

    const found = await AgencyClient.findById(client._id);
    expect(found).toBeNull();
  });

  it('should return 404 for client belonging to another agency', async () => {
    const { auth } = await createAgency();
    const { user: otherAgency } = await createAgency();

    const client = await AgencyClient.create({
      agencyId: otherAgency._id,
      name: 'Not mine',
      documentNumber: '77777777000100',
      status: 'active',
    });

    const res = await request(app)
      .delete(`/api/agency/clients/${client._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────
// GET /api/agency/dashboard
// ─────────────────────────────────────────────────
describe('GET /api/agency/dashboard', () => {
  it('should return dashboard data for agency with no data', async () => {
    const { auth } = await createAgency();

    const res = await request(app)
      .get('/api/agency/dashboard')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.summary).toBeDefined();
    expect(res.body.summary.totalClients).toBe(0);
    expect(res.body.summary.totalOrders).toBe(0);
    expect(res.body.monthlyData).toBeDefined();
    expect(res.body.categories).toBeDefined();
  });

  it('should return 403 for non-agency user', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .get('/api/agency/dashboard')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });
});
