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
import Order from '../../models/Order';

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

  it('should return 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/agency/dashboard');
    expect(res.status).toBe(401);
  });

  it('deve retornar estrutura completa de summary com campos financeiros', async () => {
    const { auth } = await createAgency();

    const res = await request(app)
      .get('/api/agency/dashboard')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('summary');
    expect(res.body).toHaveProperty('monthlyData');
    expect(res.body).toHaveProperty('categories');
    expect(res.body.summary).toHaveProperty('totalClients');
    expect(res.body.summary).toHaveProperty('totalOrders');
    // Campos financeiros presentes mesmo com valores zero
    expect(res.body.summary).toHaveProperty('totalGross');
  });

  it('deve refletir numero de clientes cadastrados no summary', async () => {
    const { user: agency, auth } = await createAgency();

    // Cria 3 clientes
    await AgencyClient.create({ agencyId: agency._id, name: 'Cliente 1', documentNumber: '11111111000101' });
    await AgencyClient.create({ agencyId: agency._id, name: 'Cliente 2', documentNumber: '22222222000101' });
    await AgencyClient.create({ agencyId: agency._id, name: 'Cliente 3', documentNumber: '33333333000101' });

    const res = await request(app)
      .get('/api/agency/dashboard')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.summary.totalClients).toBe(3);
  });
});

// ─────────────────────────────────────────────────
// GET /api/agency/dashboard — com pedidos reais
// ─────────────────────────────────────────────────
describe('GET /api/agency/dashboard — com dados reais', () => {
  async function createTestOrder(agencyId: string, status: string, totalAmount: number, agencyCommission: number) {
    return Order.create({
      buyerId: agencyId,
      buyerName: 'Agency Teste',
      buyerEmail: 'agency@test.com',
      buyerPhone: '11999999999',
      buyerDocument: '12345678000100',
      status,
      totalAmount,
      grossAmount: totalAmount * 0.8,
      agencyCommission,
      subtotal: totalAmount * 0.8,
      platformFee: totalAmount * 0.2,
      techFee: totalAmount * 0.05,
      platformSplit: totalAmount * 0.2,
      broadcasterAmount: totalAmount * 0.75,
      items: [{
        broadcasterId: new mongoose.Types.ObjectId(),
        broadcasterName: 'Radio Test',
        productId: new mongoose.Types.ObjectId(),
        productName: 'Comercial 30s',
        quantity: 5,
        unitPrice: totalAmount / 5,
        totalPrice: totalAmount,
        itemStatus: 'pending',
        schedule: new Map([['seg-sex', 5]]),
      }],
      payment: {
        method: 'pending_contact',
        status: 'pending',
        chargedAmount: totalAmount,
        totalAmount,
        walletAmountUsed: 0,
      },
    });
  }

  it('agrega totalGross e totalCommission corretamente com pedidos', async () => {
    const { user: agency, auth } = await createAgency();

    await createTestOrder(agency._id.toString(), 'paid', 1000, 150);
    await createTestOrder(agency._id.toString(), 'completed', 2000, 300);

    const res = await request(app)
      .get('/api/agency/dashboard')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.summary.totalOrders).toBe(2);
    expect(res.body.summary.totalGross).toBe(3000);
    expect(res.body.summary.totalCommission).toBe(450);
  });

  it('conta campanhas ativas corretamente', async () => {
    const { user: agency, auth } = await createAgency();

    await createTestOrder(agency._id.toString(), 'paid', 500, 75);
    await createTestOrder(agency._id.toString(), 'approved', 500, 75);
    await createTestOrder(agency._id.toString(), 'cancelled', 500, 75);

    const res = await request(app)
      .get('/api/agency/dashboard')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    // paid e approved sao ativos, cancelled nao
    expect(res.body.summary.activeCampaigns).toBe(2);
    expect(res.body.summary.totalOrders).toBe(3);
  });

  it('retorna clientBreakdown com pedidos atribuidos a clientes', async () => {
    const { user: agency, auth } = await createAgency();
    const client = await AgencyClient.create({
      agencyId: agency._id,
      name: 'Cliente Teste',
      documentNumber: '11111111000199',
    });

    await Order.create({
      buyerId: agency._id,
      buyerName: 'Agency',
      buyerEmail: 'a@b.com',
      buyerPhone: '11999999999',
      buyerDocument: '12345678000100',
      clientId: client._id,
      status: 'paid',
      totalAmount: 800,
      grossAmount: 640,
      agencyCommission: 120,
      subtotal: 640,
      platformFee: 160,
      techFee: 40,
      platformSplit: 160,
      broadcasterAmount: 600,
      items: [{
        broadcasterId: new mongoose.Types.ObjectId(),
        broadcasterName: 'Radio',
        productId: new mongoose.Types.ObjectId(),
        productName: 'Testemunhal 60s',
        quantity: 2,
        unitPrice: 400,
        totalPrice: 800,
        itemStatus: 'pending',
        schedule: new Map([['seg-sex', 2]]),
      }],
      payment: {
        method: 'pending_contact',
        status: 'pending',
        chargedAmount: 800,
        totalAmount: 800,
        walletAmountUsed: 0,
      },
    });

    const res = await request(app)
      .get('/api/agency/dashboard')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.clientBreakdown)).toBe(true);
    const clientEntry = res.body.clientBreakdown.find((c: any) => c.clientName === 'Cliente Teste');
    expect(clientEntry).toBeDefined();
    expect(clientEntry.totalOrders).toBe(1);
  });

  it('retorna categories agrupadas por tipo de produto', async () => {
    const { user: agency, auth } = await createAgency();

    await createTestOrder(agency._id.toString(), 'paid', 500, 75);

    const res = await request(app)
      .get('/api/agency/dashboard')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.categories)).toBe(true);
    // Deve ter categoria 'Comercial' baseada no productName 'Comercial 30s'
    const comercialCat = res.body.categories.find((c: any) => c.name === 'Comercial');
    expect(comercialCat).toBeDefined();
  });

  it('retorna recentOrders com os ultimos pedidos', async () => {
    const { user: agency, auth } = await createAgency();

    await createTestOrder(agency._id.toString(), 'pending_contact', 300, 45);
    await createTestOrder(agency._id.toString(), 'paid', 600, 90);

    const res = await request(app)
      .get('/api/agency/dashboard')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.recentOrders)).toBe(true);
    expect(res.body.recentOrders.length).toBe(2);
    expect(res.body.recentOrders[0]).toHaveProperty('status');
    expect(res.body.recentOrders[0]).toHaveProperty('totalAmount');
  });

  it('calcChange retorna 100 quando previous=0 e current>0', async () => {
    const { user: agency, auth } = await createAgency();

    // Cria pedido no mes atual para ter currentMonthOrders > 0 e previousMonthOrders = 0
    await createTestOrder(agency._id.toString(), 'paid', 1000, 150);

    const res = await request(app)
      .get('/api/agency/dashboard')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    // changes.orders deveria ser 100 (100% de crescimento de 0 para N)
    expect(res.body.summary.changes.orders).toBe(100);
  });
});
