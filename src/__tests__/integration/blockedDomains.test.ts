/**
 * Integration Tests — Blocked Domains API
 *
 * Tests real HTTP endpoints end-to-end.
 * POST   /api/blocked-domains/check          (public)
 * GET    /api/blocked-domains                 (admin)
 * GET    /api/blocked-domains/defaults        (admin)
 * POST   /api/blocked-domains                 (admin)
 * DELETE /api/blocked-domains/:id             (admin)
 */

import '../helpers/mocks';

import request from 'supertest';
import express, { Application, Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';

import { mongoSanitize, xssSanitize, dedupeQuery } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';
import blockedDomainRoutes from '../../routes/blockedDomainRoutes';
import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import {
  createAdmin,
  createAdvertiser,
} from '../helpers/authHelper';
import BlockedDomain from '../../models/BlockedDomain';

function createApp(): Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(mongoSanitize);
  app.use(xssSanitize);
  app.use(dedupeQuery);
  app.use(csrfProtection);
  app.use('/api/blocked-domains', blockedDomainRoutes);
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
// POST /api/blocked-domains/check (public)
// ─────────────────────────────────────────────────
describe('POST /api/blocked-domains/check', () => {
  it('should return blocked=true for free email domains (gmail)', async () => {
    const res = await request(app)
      .post('/api/blocked-domains/check')
      .send({ email: 'test@gmail.com' });

    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(true);
  });

  it('should return blocked=true for free email domains (hotmail)', async () => {
    const res = await request(app)
      .post('/api/blocked-domains/check')
      .send({ email: 'test@hotmail.com' });

    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(true);
  });

  it('should return blocked=false for corporate email', async () => {
    const res = await request(app)
      .post('/api/blocked-domains/check')
      .send({ email: 'user@empresa.com.br' });

    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(false);
  });

  it('should return blocked=true for admin-added custom domain', async () => {
    const { user: admin } = await createAdmin();

    await BlockedDomain.create({
      domain: 'spammer.com',
      reason: 'Known spam domain',
      createdBy: admin._id,
    });

    const res = await request(app)
      .post('/api/blocked-domains/check')
      .send({ email: 'user@spammer.com' });

    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(true);
  });

  it('should return 400 when email is missing', async () => {
    const res = await request(app)
      .post('/api/blocked-domains/check')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/obrigatório/i);
  });
});

// ─────────────────────────────────────────────────
// GET /api/blocked-domains (admin)
// ─────────────────────────────────────────────────
describe('GET /api/blocked-domains', () => {
  it('should list blocked domains for admin', async () => {
    const { user: admin, auth } = await createAdmin();

    await BlockedDomain.create({
      domain: 'evil.com',
      reason: 'Spam',
      createdBy: admin._id,
    });

    const res = await request(app)
      .get('/api/blocked-domains')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.domains).toHaveLength(1);
    expect(res.body.domains[0].domain).toBe('evil.com');
  });

  it('should return 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/blocked-domains');
    expect(res.status).toBe(401);
  });

  it('should return 403 for non-admin user', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .get('/api/blocked-domains')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────
// GET /api/blocked-domains/defaults (admin)
// ─────────────────────────────────────────────────
describe('GET /api/blocked-domains/defaults', () => {
  it('should return hardcoded free email domains list', async () => {
    const { auth } = await createAdmin();

    const res = await request(app)
      .get('/api/blocked-domains/defaults')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.domains).toBeDefined();
    expect(Array.isArray(res.body.domains)).toBe(true);
    expect(res.body.domains).toContain('gmail.com');
    expect(res.body.domains).toContain('hotmail.com');
  });
});

// ─────────────────────────────────────────────────
// POST /api/blocked-domains (admin)
// ─────────────────────────────────────────────────
describe('POST /api/blocked-domains', () => {
  it('should add a new blocked domain', async () => {
    const { auth } = await createAdmin();

    const res = await request(app)
      .post('/api/blocked-domains')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ domain: 'badactor.com', reason: 'Known spam' });

    expect(res.status).toBe(201);
    expect(res.body.message).toMatch(/adicionado/i);
    expect(res.body.domain.domain).toBe('badactor.com');
  });

  it('should reject when domain is missing', async () => {
    const { auth } = await createAdmin();

    const res = await request(app)
      .post('/api/blocked-domains')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/obrigatório/i);
  });

  it('should reject domain already in hardcoded list', async () => {
    const { auth } = await createAdmin();

    const res = await request(app)
      .post('/api/blocked-domains')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ domain: 'gmail.com' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/lista padrão/i);
  });

  it('should reject duplicate domain in DB', async () => {
    const { user: admin, auth } = await createAdmin();

    await BlockedDomain.create({
      domain: 'existing.com',
      createdBy: admin._id,
    });

    const res = await request(app)
      .post('/api/blocked-domains')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ domain: 'existing.com' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/já está/i);
  });
});

// ─────────────────────────────────────────────────
// DELETE /api/blocked-domains/:id (admin)
// ─────────────────────────────────────────────────
describe('DELETE /api/blocked-domains/:id', () => {
  it('should remove a blocked domain', async () => {
    const { user: admin, auth } = await createAdmin();

    const blocked = await BlockedDomain.create({
      domain: 'removeme.com',
      createdBy: admin._id,
    });

    const res = await request(app)
      .delete(`/api/blocked-domains/${blocked._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/removido/i);

    const found = await BlockedDomain.findById(blocked._id);
    expect(found).toBeNull();
  });

  it('should return 404 for non-existent domain', async () => {
    const { auth } = await createAdmin();
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .delete(`/api/blocked-domains/${fakeId}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(404);
  });
});
