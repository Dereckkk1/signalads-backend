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

import { mongoSanitize, xssSanitize, dedupeQuery } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';
import broadcasterCalendarRoutes from '../../routes/broadcasterCalendarRoutes';

import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { createBroadcaster, createAdvertiser } from '../helpers/authHelper';
import { Sponsorship } from '../../models/Sponsorship';
import Order from '../../models/Order';
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

  it('retorna array vazio quando nao ha patrocinios no periodo', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .get('/api/broadcaster/calendar?start=2020-01-01&end=2020-01-31')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(0);
    expect(res.body.totalEvents).toBe(0);
  });

  it('retorna apenas eventos da propria emissora (isolamento)', async () => {
    const { user: broadcaster1, auth: auth1 } = await createBroadcaster();
    const { user: broadcaster2 } = await createBroadcaster();

    await Sponsorship.create({
      broadcasterId: broadcaster2._id,
      programName: 'Programa da Outra Emissora',
      timeRange: { start: '07:00', end: '08:00' },
      daysOfWeek: [1],
      insertions: [{ name: 'Spot', duration: 30, quantityPerDay: 1, requiresMaterial: false }],
      netPrice: 200,
      pricePerMonth: 250,
      isActive: true,
    });

    const res = await request(app)
      .get(`/api/broadcaster/calendar?start=${START}&end=${END}`)
      .set('Cookie', auth1.cookieHeader)
      .set('X-CSRF-Token', auth1.csrfHeader);

    expect(res.status).toBe(200);
    const outsideEvents = res.body.events.filter(
      (e: any) => e.title === 'Programa da Outra Emissora'
    );
    expect(outsideEvents).toHaveLength(0);
  });

  it('retorna eventos de multiplos patrocinios no mesmo periodo', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();

    await Sponsorship.create({
      broadcasterId: broadcaster._id,
      programName: 'Matinal',
      timeRange: { start: '06:00', end: '09:00' },
      daysOfWeek: [1, 2, 3, 4, 5],
      insertions: [{ name: 'Citação', duration: 0, quantityPerDay: 1, requiresMaterial: false }],
      netPrice: 300,
      pricePerMonth: 375,
      isActive: true,
    });

    await Sponsorship.create({
      broadcasterId: broadcaster._id,
      programName: 'Vespertino',
      timeRange: { start: '14:00', end: '17:00' },
      daysOfWeek: [1, 2, 3, 4, 5],
      insertions: [{ name: 'Vinheta', duration: 5, quantityPerDay: 2, requiresMaterial: false }],
      netPrice: 400,
      pricePerMonth: 500,
      isActive: true,
    });

    const res = await request(app)
      .get(`/api/broadcaster/calendar?start=${START}&end=${END}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    const matinalEvents = res.body.events.filter((e: any) => e.title === 'Matinal');
    const vespertinoEvents = res.body.events.filter((e: any) => e.title === 'Vespertino');
    expect(matinalEvents.length).toBeGreaterThan(0);
    expect(vespertinoEvents.length).toBeGreaterThan(0);
  });

  it('ignora patrocinios inativos', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();

    await Sponsorship.create({
      broadcasterId: broadcaster._id,
      programName: 'Programa Inativo',
      timeRange: { start: '10:00', end: '11:00' },
      daysOfWeek: [1, 2, 3, 4, 5],
      insertions: [{ name: 'Spot', duration: 30, quantityPerDay: 1, requiresMaterial: false }],
      netPrice: 100,
      pricePerMonth: 125,
      isActive: false, // inativo!
    });

    const res = await request(app)
      .get(`/api/broadcaster/calendar?start=${START}&end=${END}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    const inactiveEvents = res.body.events.filter((e: any) => e.title === 'Programa Inativo');
    expect(inactiveEvents).toHaveLength(0);
  });

  it('gera eventos vencimento_parcela a partir de orders com contract', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();

    await Order.create({
      orderNumber: `ORD-TEST-${Date.now()}`,
      buyerId: broadcaster._id,
      buyerName: 'Cliente XYZ',
      buyerEmail: 'cli@xyz.com',
      buyerPhone: '11999999999',
      buyerDocument: '12345678900',
      items: [{
        productId: 'p1',
        productName: 'Comercial 30s',
        broadcasterName: 'Radio',
        broadcasterId: broadcaster._id.toString(),
        quantity: 10,
        unitPrice: 100,
        totalPrice: 1000,
        schedule: new Map(),
      }],
      payment: { method: 'pending_contact' as const, status: 'pending' as const, walletAmountUsed: 0, chargedAmount: 1000, totalAmount: 1000 },
      splits: [],
      status: 'approved',
      isFromBroadcasterProposal: true,
      grossAmount: 1000, broadcasterAmount: 1000, platformSplit: 0, techFee: 0,
      agencyCommission: 0, monitoringCost: 0, isMonitoringEnabled: false,
      totalAmount: 1000, subtotal: 1000, platformFee: 0,
      contract: {
        contractNumber: 'CTR-ABC123-0001',
        totalValue: 1000,
        installmentsCount: 3,
        procedure: 'Boleto',
        carrier: 'Carteira',
        descriptionTags: [],
        installments: [
          { number: 1, dueDate: new Date('2026-04-10'), amount: 333.33 },
          { number: 2, dueDate: new Date('2026-04-20'), amount: 333.33 },
          { number: 3, dueDate: new Date('2026-04-30'), amount: 333.34 },
        ],
      },
    });

    const res = await request(app)
      .get(`/api/broadcaster/calendar?start=${START}&end=${END}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    const parcelaEvents = res.body.events.filter((e: any) => e.type === 'vencimento_parcela');
    expect(parcelaEvents).toHaveLength(3);
    expect(parcelaEvents[0].contractNumber).toBe('CTR-ABC123-0001');
    expect(parcelaEvents[0].procedure).toBe('Boleto');
    expect(parcelaEvents[0].amount).toBe(333.33);
    expect(parcelaEvents[0].installmentNumber).toBe(1);

    // dateSummary tem o campo parcelas
    const d10 = res.body.dateSummary['2026-04-10'];
    expect(d10).toBeDefined();
    expect(d10.parcelas).toBe(1);
  });

  it('nao duplica parcelas quando proposta approved ja foi convertida em order', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();

    const order = await Order.create({
      orderNumber: `ORD-DUP-${Date.now()}`,
      buyerId: broadcaster._id,
      buyerName: 'Cliente',
      buyerEmail: 'c@c.com',
      buyerPhone: '1',
      buyerDocument: '1',
      items: [{
        productId: 'p1', productName: 'P', broadcasterName: 'R',
        broadcasterId: broadcaster._id.toString(),
        quantity: 1, unitPrice: 100, totalPrice: 100, schedule: new Map(),
      }],
      payment: { method: 'pending_contact' as const, status: 'pending' as const, walletAmountUsed: 0, chargedAmount: 100, totalAmount: 100 },
      splits: [],
      status: 'approved',
      isFromBroadcasterProposal: true,
      grossAmount: 100, broadcasterAmount: 100, platformSplit: 0, techFee: 0,
      agencyCommission: 0, monitoringCost: 0, isMonitoringEnabled: false,
      totalAmount: 100, subtotal: 100, platformFee: 0,
      contract: {
        contractNumber: 'CTR-X-0001', totalValue: 100, installmentsCount: 1,
        descriptionTags: [],
        installments: [{ number: 1, dueDate: new Date('2026-04-15'), amount: 100 }],
      },
    });

    await Proposal.create({
      ownerType: 'broadcaster',
      broadcasterId: broadcaster._id,
      title: 'P',
      slug: `dup-${Date.now()}`,
      items: [{ productName: 'P', quantity: 1, unitPrice: 100, totalPrice: 100, productType: 'Comercial' }],
      grossAmount: 100, totalAmount: 100,
      status: 'approved',
      convertedOrderId: order._id,
      contract: {
        contractNumber: 'CTR-X-0001', totalValue: 100, installmentsCount: 1,
        descriptionTags: [],
        installments: [{ number: 1, dueDate: new Date('2026-04-15'), amount: 100 }],
      },
    });

    const res = await request(app)
      .get(`/api/broadcaster/calendar?start=${START}&end=${END}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    const parcelaEvents = res.body.events.filter((e: any) => e.type === 'vencimento_parcela');
    // So um evento — vem do Order, nao duplica via Proposal
    expect(parcelaEvents).toHaveLength(1);
  });
});
