/**
 * Integration Tests — Broadcaster Combos API
 *
 * GET    /api/broadcaster-combos
 * POST   /api/broadcaster-combos
 * PUT    /api/broadcaster-combos/:id
 * DELETE /api/broadcaster-combos/:id
 */

import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';
import express from 'express';
import cookieParser from 'cookie-parser';
import hpp from 'hpp';

import { mongoSanitize, xssSanitize } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';
import broadcasterComboRoutes from '../../routes/broadcasterComboRoutes';

import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { createBroadcaster, createAdvertiser } from '../helpers/authHelper';
import { Product } from '../../models/Product';
import { Sponsorship } from '../../models/Sponsorship';
import { Combo } from '../../models/Combo';

function createComboTestApp(): Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(mongoSanitize);
  app.use(xssSanitize);
  app.use(hpp());
  app.use(csrfProtection);
  app.use('/api/broadcaster-combos', broadcasterComboRoutes);
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
  app = createComboTestApp();
});

afterEach(async () => {
  await clearTestDB();
});

afterAll(async () => {
  await disconnectTestDB();
});

async function createBroadcasterWithCatalog() {
  const { user: broadcaster, auth } = await createBroadcaster();

  const product = await Product.create({
    broadcasterId: broadcaster._id,
    spotType: 'Comercial 30s',
    duration: 30,
    timeSlot: 'Rotativo',
    netPrice: 100,
    pricePerInsertion: 125,
    isActive: true
  });

  const sponsorship = await Sponsorship.create({
    broadcasterId: broadcaster._id,
    programName: 'Show da Manhã',
    timeRange: { start: '08:00', end: '10:00' },
    daysOfWeek: [1, 2, 3, 4, 5],
    insertions: [{ name: 'Citação', duration: 0, quantityPerDay: 2, requiresMaterial: false }],
    netPrice: 500,
    pricePerMonth: 625
  });

  return { broadcaster, auth, product, sponsorship };
}

describe('POST /api/broadcaster-combos', () => {
  it('cria combo com produto e patrocinio', async () => {
    const { auth, product, sponsorship } = await createBroadcasterWithCatalog();

    const res = await request(app)
      .post('/api/broadcaster-combos')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        name: 'Combo Premium',
        description: 'Pacote completo',
        items: [
          { itemType: 'product', productId: product._id.toString(), defaultQuantity: 10, defaultDiscountType: 'percentage', defaultDiscountValue: 5 },
          { itemType: 'sponsorship', sponsorshipId: sponsorship._id.toString(), defaultQuantity: 1 }
        ]
      });

    expect(res.status).toBe(201);
    expect(res.body.combo).toBeDefined();
    expect(res.body.combo.name).toBe('Combo Premium');
    expect(res.body.combo.items).toHaveLength(2);
    expect(res.body.combo.items[0].defaultQuantity).toBe(10);
    expect(res.body.combo.items[0].defaultDiscountValue).toBe(5);
  });

  it('rejeita combo sem itens', async () => {
    const { auth } = await createBroadcasterWithCatalog();

    const res = await request(app)
      .post('/api/broadcaster-combos')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'Combo Vazio', items: [] });

    expect(res.status).toBe(400);
  });

  it('rejeita combo sem nome', async () => {
    const { auth, product } = await createBroadcasterWithCatalog();

    const res = await request(app)
      .post('/api/broadcaster-combos')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ items: [{ itemType: 'product', productId: product._id.toString(), defaultQuantity: 1 }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/nome/i);
  });

  it('rejeita produto de outra emissora', async () => {
    const { auth } = await createBroadcasterWithCatalog();
    const { user: outroBroadcaster } = await createBroadcaster();
    const outroProd = await Product.create({
      broadcasterId: outroBroadcaster._id,
      spotType: 'Comercial 15s', duration: 15, timeSlot: 'Rotativo',
      netPrice: 50, pricePerInsertion: 62.5, isActive: true
    });

    const res = await request(app)
      .post('/api/broadcaster-combos')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        name: 'Combo Fraudado',
        items: [{ itemType: 'product', productId: outroProd._id.toString(), defaultQuantity: 1 }]
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/não pertencem/i);
  });

  it('rejeita usuario nao-broadcaster', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .post('/api/broadcaster-combos')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        name: 'Combo',
        items: [{ itemType: 'product', productId: '507f1f77bcf86cd799439011', defaultQuantity: 1 }]
      });

    expect(res.status).toBe(403);
  });
});

describe('GET /api/broadcaster-combos', () => {
  it('lista combos da emissora autenticada', async () => {
    const { auth, product } = await createBroadcasterWithCatalog();
    await Combo.create({
      broadcasterId: (product as any).broadcasterId,
      name: 'Combo A',
      items: [{ itemType: 'product', productId: product._id, defaultQuantity: 5 }]
    });

    const res = await request(app)
      .get('/api/broadcaster-combos')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.combos).toHaveLength(1);
    expect(res.body.combos[0].name).toBe('Combo A');
  });

  it('nao retorna combos de outra emissora', async () => {
    const { auth } = await createBroadcasterWithCatalog();
    const { user: outro } = await createBroadcaster();
    const outroProd = await Product.create({
      broadcasterId: outro._id,
      spotType: 'Comercial 30s', duration: 30, timeSlot: 'Rotativo',
      netPrice: 100, pricePerInsertion: 125, isActive: true
    });
    await Combo.create({
      broadcasterId: outro._id,
      name: 'Combo Alheio',
      items: [{ itemType: 'product', productId: outroProd._id, defaultQuantity: 1 }]
    });

    const res = await request(app)
      .get('/api/broadcaster-combos')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.combos).toHaveLength(0);
  });
});

describe('PUT /api/broadcaster-combos/:id', () => {
  it('atualiza nome e itens', async () => {
    const { auth, product, sponsorship } = await createBroadcasterWithCatalog();
    const combo = await Combo.create({
      broadcasterId: (product as any).broadcasterId,
      name: 'Combo Original',
      items: [{ itemType: 'product', productId: product._id, defaultQuantity: 5 }]
    });

    const res = await request(app)
      .put(`/api/broadcaster-combos/${combo._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        name: 'Combo Atualizado',
        items: [
          { itemType: 'product', productId: product._id.toString(), defaultQuantity: 20 },
          { itemType: 'sponsorship', sponsorshipId: sponsorship._id.toString(), defaultQuantity: 2 }
        ]
      });

    expect(res.status).toBe(200);
    expect(res.body.combo.name).toBe('Combo Atualizado');
    expect(res.body.combo.items).toHaveLength(2);
  });

  it('retorna 404 para combo de outra emissora', async () => {
    const { auth } = await createBroadcasterWithCatalog();
    const { user: outro } = await createBroadcaster();
    const outroProd = await Product.create({
      broadcasterId: outro._id,
      spotType: 'C30', duration: 30, timeSlot: 'R', netPrice: 1, pricePerInsertion: 1.25, isActive: true
    });
    const outroCombo = await Combo.create({
      broadcasterId: outro._id, name: 'X',
      items: [{ itemType: 'product', productId: outroProd._id, defaultQuantity: 1 }]
    });

    const res = await request(app)
      .put(`/api/broadcaster-combos/${outroCombo._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'hack' });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/broadcaster-combos/:id', () => {
  it('deleta combo', async () => {
    const { auth, product } = await createBroadcasterWithCatalog();
    const combo = await Combo.create({
      broadcasterId: (product as any).broadcasterId,
      name: 'A remover',
      items: [{ itemType: 'product', productId: product._id, defaultQuantity: 1 }]
    });

    const res = await request(app)
      .delete(`/api/broadcaster-combos/${combo._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    const still = await Combo.findById(combo._id);
    expect(still).toBeNull();
  });
});
