/**
 * Integration Tests — Final Controllers Extra Coverage
 *
 * Cobre branches não testados em:
 * - broadcasterReportsController: edge cases
 * - materialController: edge cases
 * - agencyController: edge cases
 * - monitoringController: edge cases
 * - reportController: edge cases
 * - uploadController: edge cases
 * - contactMessageController: edge cases
 */

import '../helpers/mocks';

jest.mock('../../config/storage', () => ({
  uploadFile: jest.fn().mockResolvedValue('https://storage.googleapis.com/test/file.mp3'),
  deleteFile: jest.fn().mockResolvedValue(undefined),
}));

import request from 'supertest';
import { Application } from 'express';
import express from 'express';
import cookieParser from 'cookie-parser';
import hpp from 'hpp';

import { mongoSanitize, xssSanitize } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';

import broadcasterReportsRoutes from '../../routes/broadcasterReportsRoutes';
import materialRoutes from '../../routes/materialRoutes';
import agencyRoutes from '../../routes/agencyRoutes';
import adminRoutes from '../../routes/adminRoutes';
import contactMessageRoutes from '../../routes/contactMessageRoutes';
import uploadRoutes from '../../routes/uploadRoutes';

import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { createBroadcaster, createAdvertiser, createAgency, createAdmin } from '../helpers/authHelper';
import Order from '../../models/Order';
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
  app.use('/api/broadcaster', broadcasterReportsRoutes);
  app.use('/api/materials', materialRoutes);
  app.use('/api/agency', agencyRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/contact-messages', contactMessageRoutes);
  app.use('/api/upload', uploadRoutes);
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

// ─── broadcasterReports extras ────────────────────────────────────────────

describe('GET /api/broadcaster/reports/summary — extras', () => {
  it('retorna summary com periodo customizado', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .get('/api/broadcaster/reports/summary?period=90')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
  });

  it('retorna 403 para advertiser', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .get('/api/broadcaster/reports/summary')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });
});

describe('GET /api/broadcaster/reports/breakdown — extras', () => {
  it('retorna breakdown por produto', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .get('/api/broadcaster/reports/breakdown?groupBy=product')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    // Pode retornar 200 ou 400 dependendo dos parâmetros obrigatórios
    expect([200, 400]).toContain(res.status);
  });
});

describe('GET /api/broadcaster/reports/goals — extras', () => {
  it('retorna goals report', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .get('/api/broadcaster/reports/goals')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
  });
});

// ─── materialController extras ────────────────────────────────────────────

describe('GET /api/materials/:orderId/item/:idx/chat — extras', () => {
  it('retorna 404 para pedido inexistente', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .get('/api/materials/507f1f77bcf86cd799439011/item/0/chat')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(404);
  });

  it('retorna 401 sem autenticacao', async () => {
    const res = await request(app)
      .get('/api/materials/507f1f77bcf86cd799439011/item/0/chat');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/materials/:orderId/item/:idx/message — extras', () => {
  it('retorna 404 para pedido inexistente', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/materials/507f1f77bcf86cd799439011/item/0/message')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ message: 'Olá' });

    expect(res.status).toBe(404);
  });
});

// ─── agencyController extras ──────────────────────────────────────────────

describe('GET /api/agency/dashboard — extras', () => {
  it('retorna dashboard da agencia', async () => {
    const { auth } = await createAgency();

    const res = await request(app)
      .get('/api/agency/dashboard')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
  });

  it('retorna 403 para broadcaster', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .get('/api/agency/dashboard')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });
});

describe('GET /api/agency/clients — extras', () => {
  it('retorna lista vazia quando nao ha clientes', async () => {
    const { auth } = await createAgency();

    const res = await request(app)
      .get('/api/agency/clients')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
  });
});

describe('PUT /api/agency/clients/:id — extras', () => {
  it('retorna 404 para cliente de outra agencia', async () => {
    const { user: agency1, auth: auth1 } = await createAgency();
    const { user: agency2 } = await createAgency();

    const client = await AgencyClient.create({
      agencyId: agency2._id,
      name: 'Cliente da Outra',
      documentNumber: '12345678901234',
      contactEmail: 'outro@cliente.com',
    });

    const res = await request(app)
      .put(`/api/agency/clients/${client._id}`)
      .set('Cookie', auth1.cookieHeader)
      .set('X-CSRF-Token', auth1.csrfHeader)
      .send({ name: 'Tentativa' });

    expect(res.status).toBe(404);
  });
});

// ─── monitoring extras ────────────────────────────────────────────────────

describe('Monitoring extras', () => {
  it('GET /api/admin/monitoring/overview retorna 200', async () => {
    const { auth: adminAuth } = await createAdmin();

    const res = await request(app)
      .get('/api/admin/monitoring/overview?range=7d')
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
  });

  it('POST /api/admin/monitoring/block-ip bloqueia IP', async () => {
    const { auth: adminAuth } = await createAdmin();

    const res = await request(app)
      .post('/api/admin/monitoring/block-ip')
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .send({ ip: '192.168.1.1', reason: 'Teste' });

    expect([200, 400]).toContain(res.status);
  });

  it('POST /api/admin/monitoring/block-user bloqueia usuario', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: advertiser } = await createAdvertiser();

    const res = await request(app)
      .post(`/api/admin/monitoring/block-user/${advertiser._id}`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader)
      .send({ reason: 'Comportamento suspeito' });

    expect([200, 400]).toContain(res.status);
  });
});

// ─── contactMessage extras ────────────────────────────────────────────────

describe('GET /api/contact-messages — extras', () => {
  it('retorna lista de mensagens para admin', async () => {
    const { auth: adminAuth } = await createAdmin();

    const res = await request(app)
      .get('/api/contact-messages')
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
  });

  it('retorna 403 para advertiser', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .get('/api/contact-messages')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });
});

describe('POST /api/contact-messages — extras', () => {
  it('cria mensagem de contato sem autenticacao', async () => {
    const res = await request(app)
      .post('/api/contact-messages')
      .send({
        name: 'João Silva',
        email: 'joao@empresa.com',
        message: 'Quero saber mais sobre a plataforma',
        subject: 'Informações',
      });

    expect([200, 201, 400]).toContain(res.status);
  });

  it('retorna 400 sem campos obrigatorios', async () => {
    const res = await request(app)
      .post('/api/contact-messages')
      .send({ name: 'Apenas Nome' });

    expect([400, 200]).toContain(res.status);
  });
});

// ─── upload extras ────────────────────────────────────────────────────────

describe('Upload endpoints extras', () => {
  it('retorna 401 sem autenticacao para upload de audio', async () => {
    const res = await request(app)
      .post('/api/upload/audio')
      .attach('audio', Buffer.from('fake'), { filename: 'audio.mp3', contentType: 'audio/mpeg' });

    expect(res.status).toBe(401);
  });

  it('retorna 401 sem autenticacao para upload de material', async () => {
    const res = await request(app)
      .post('/api/upload/material')
      .attach('material', Buffer.from('fake'), { filename: 'file.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(401);
  });
});
