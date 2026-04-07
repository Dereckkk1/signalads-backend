/**
 * Integration Tests — Contact Messages API
 *
 * Tests real HTTP endpoints end-to-end.
 * POST   /api/contact-messages           (public, rate limited)
 * GET    /api/contact-messages            (admin)
 * GET    /api/contact-messages/unread-count (admin)
 * GET    /api/contact-messages/:id        (admin)
 * DELETE /api/contact-messages/:id        (admin)
 */

import '../helpers/mocks';

import request from 'supertest';
import express, { Application, Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import hpp from 'hpp';
import mongoose from 'mongoose';

import { mongoSanitize, xssSanitize } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';
import contactMessageRoutes from '../../routes/contactMessageRoutes';
import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import {
  createAdmin,
  createAdvertiser,
} from '../helpers/authHelper';
import ContactMessage from '../../models/ContactMessage';

function createApp(): Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(mongoSanitize);
  app.use(xssSanitize);
  app.use(hpp());
  app.use(csrfProtection);
  app.use('/api/contact-messages', contactMessageRoutes);
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
// POST /api/contact-messages (public)
// ─────────────────────────────────────────────────
describe('POST /api/contact-messages', () => {
  it('should create a contact message successfully', async () => {
    const res = await request(app)
      .post('/api/contact-messages')
      .send({
        emitterName: 'Joao Silva',
        email: 'joao@empresa.com.br',
        phone: '11999999999',
        message: 'Gostaria de saber mais sobre o servico.',
      });

    expect(res.status).toBe(201);
    expect(res.body.message).toMatch(/sucesso/i);
    expect(res.body.data.emitterName).toBe('Joao Silva');

    const msg = await ContactMessage.findOne({ email: 'joao@empresa.com.br' });
    expect(msg).not.toBeNull();
    expect(msg!.read).toBe(false);
  });

  it('should create with optional category and broadcasterInfo', async () => {
    const res = await request(app)
      .post('/api/contact-messages')
      .send({
        emitterName: 'Maria',
        email: 'maria@emissora.com',
        phone: '11888888888',
        message: 'Quero cadastrar minha radio.',
        category: 'new_broadcaster',
        broadcasterInfo: { stationName: 'Radio Maria FM', dial: '99.9', city: 'SP' },
      });

    expect(res.status).toBe(201);
    expect(res.body.data.category).toBe('new_broadcaster');
  });

  it('should reject when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/contact-messages')
      .send({ emitterName: 'Test' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/obrigatórios/i);
  });

  it('should reject when email is missing', async () => {
    const res = await request(app)
      .post('/api/contact-messages')
      .send({
        emitterName: 'Test',
        phone: '11999999999',
        message: 'Hello',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/obrigatórios/i);
  });
});

// ─────────────────────────────────────────────────
// GET /api/contact-messages (admin)
// ─────────────────────────────────────────────────
describe('GET /api/contact-messages', () => {
  it('should list all messages for admin', async () => {
    await ContactMessage.create({
      emitterName: 'User 1',
      email: 'u1@test.com',
      phone: '1111',
      message: 'Msg 1',
    });
    await ContactMessage.create({
      emitterName: 'User 2',
      email: 'u2@test.com',
      phone: '2222',
      message: 'Msg 2',
    });

    const { auth } = await createAdmin();

    const res = await request(app)
      .get('/api/contact-messages')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('should return 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/contact-messages');
    expect(res.status).toBe(401);
  });

  it('should return 403 for non-admin user', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .get('/api/contact-messages')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────
// GET /api/contact-messages/unread-count (admin)
// ─────────────────────────────────────────────────
describe('GET /api/contact-messages/unread-count', () => {
  it('should return count of unread messages', async () => {
    await ContactMessage.create({
      emitterName: 'Unread',
      email: 'unread@test.com',
      phone: '1111',
      message: 'Unread msg',
      read: false,
    });
    await ContactMessage.create({
      emitterName: 'Read',
      email: 'read@test.com',
      phone: '2222',
      message: 'Read msg',
      read: true,
    });

    const { auth } = await createAdmin();

    const res = await request(app)
      .get('/api/contact-messages/unread-count')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.unreadCount).toBe(1);
  });
});

// ─────────────────────────────────────────────────
// GET /api/contact-messages/:id (admin)
// ─────────────────────────────────────────────────
describe('GET /api/contact-messages/:id', () => {
  it('should return message and mark as read', async () => {
    const msg = await ContactMessage.create({
      emitterName: 'Viewer',
      email: 'viewer@test.com',
      phone: '3333',
      message: 'Please read me',
      read: false,
    });

    const { auth } = await createAdmin();

    const res = await request(app)
      .get(`/api/contact-messages/${msg._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.emitterName).toBe('Viewer');
    expect(res.body.read).toBe(true);

    // Verify in DB
    const updated = await ContactMessage.findById(msg._id);
    expect(updated!.read).toBe(true);
  });

  it('should return 404 for non-existent message', async () => {
    const { auth } = await createAdmin();
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .get(`/api/contact-messages/${fakeId}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────
// DELETE /api/contact-messages/:id (admin)
// ─────────────────────────────────────────────────
describe('DELETE /api/contact-messages/:id', () => {
  it('should delete a message', async () => {
    const msg = await ContactMessage.create({
      emitterName: 'Delete Me',
      email: 'del@test.com',
      phone: '4444',
      message: 'Bye',
    });

    const { auth } = await createAdmin();

    const res = await request(app)
      .delete(`/api/contact-messages/${msg._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/excluída/i);

    const found = await ContactMessage.findById(msg._id);
    expect(found).toBeNull();
  });

  it('should return 404 for non-existent message', async () => {
    const { auth } = await createAdmin();
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .delete(`/api/contact-messages/${fakeId}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(404);
  });

  it('should return 403 for non-admin user', async () => {
    const msg = await ContactMessage.create({
      emitterName: 'Protected',
      email: 'p@test.com',
      phone: '5555',
      message: 'No delete',
    });

    const { auth } = await createAdvertiser();

    const res = await request(app)
      .delete(`/api/contact-messages/${msg._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });
});
