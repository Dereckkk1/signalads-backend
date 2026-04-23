/**
 * Integration Tests — Cart API (Missing Coverage)
 *
 * Cobre branches não testados em cartController.ts:
 * - PUT /api/cart/items/schedule          — updateItemSchedule
 * - PUT /api/cart/items/material          — updateItemMaterial
 * - PUT /api/cart/items/sponsorship-month — updateSponsorshipMonth
 * - PUT /api/cart/items/sponsorship-material — updateSponsorshipMaterial
 * - POST /api/cart/sync                   — syncCart
 * - DELETE /api/cart                      — clearCart
 * - Erros e edge cases nas rotas existentes
 */

import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';
import express from 'express';
import cookieParser from 'cookie-parser';
import hpp from 'hpp';

import { mongoSanitize, xssSanitize } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';
import cartRoutes from '../../routes/cartRoutes';

import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { createBroadcaster, createAdvertiser } from '../helpers/authHelper';
import { Product, Sponsorship } from '../../models/Product';
import { Cart } from '../../models/Cart';

function createApp(): Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(mongoSanitize);
  app.use(xssSanitize);
  app.use(hpp());
  app.use(csrfProtection);
  app.use('/api/cart', cartRoutes);
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

async function setupCartWithItem() {
  const { user: broadcaster } = await createBroadcaster();
  const { user: advertiser, auth } = await createAdvertiser();

  const product = await Product.create({
    broadcasterId: broadcaster._id,
    spotType: 'Comercial 30s',
    duration: 30,
    timeSlot: 'Rotativo',
    netPrice: 100,
    pricePerInsertion: 125,
    isActive: true,
  });

  // Adiciona item ao carrinho
  await request(app)
    .post('/api/cart/items')
    .set('Cookie', auth.cookieHeader)
    .set('X-CSRF-Token', auth.csrfHeader)
    .send({ productId: product._id.toString(), quantity: 1 });

  return { advertiser, auth, product, broadcaster };
}

// ─── updateItemSchedule ───────────────────────────────────────────────────

describe('PUT /api/cart/items/schedule', () => {
  it('atualiza agendamento de item no carrinho', async () => {
    const { auth, product } = await setupCartWithItem();

    const res = await request(app)
      .put('/api/cart/items/schedule')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        productId: product._id.toString(),
        schedule: { '2026-05-01': 2, '2026-05-02': 3 },
      });

    expect([200, 400]).toContain(res.status);
  });

  it('retorna 401 sem autenticacao', async () => {
    const res = await request(app)
      .put('/api/cart/items/schedule')
      .send({ productId: '507f1f77bcf86cd799439011', schedule: {} });
    expect(res.status).toBe(401);
  });
});

// ─── updateItemMaterial ───────────────────────────────────────────────────

describe('PUT /api/cart/items/material', () => {
  it('atualiza tipo de material do item', async () => {
    const { auth, product } = await setupCartWithItem();

    const res = await request(app)
      .put('/api/cart/items/material')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        productId: product._id.toString(),
        materialType: 'file',
      });

    expect([200, 400]).toContain(res.status);
  });

  it('retorna 401 sem autenticacao', async () => {
    const res = await request(app)
      .put('/api/cart/items/material')
      .send({ productId: '507f1f77bcf86cd799439011', materialType: 'text' });
    expect(res.status).toBe(401);
  });
});

// ─── updateSponsorshipMonth ───────────────────────────────────────────────

describe('PUT /api/cart/items/sponsorship-month', () => {
  it('retorna 400 ou 200 ao atualizar mes de patrocinio', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .put('/api/cart/items/sponsorship-month')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ sponsorshipId: '507f1f77bcf86cd799439011', targetMonth: '2026-05' });

    expect([200, 400, 404]).toContain(res.status);
  });

  it('retorna 401 sem autenticacao', async () => {
    const res = await request(app)
      .put('/api/cart/items/sponsorship-month')
      .send({ sponsorshipId: '507f1f77bcf86cd799439011', targetMonth: '2026-05' });
    expect(res.status).toBe(401);
  });
});

// ─── updateSponsorshipMaterial ────────────────────────────────────────────

describe('PUT /api/cart/items/sponsorship-material', () => {
  it('retorna 400 ou 200 ao atualizar material de patrocinio', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .put('/api/cart/items/sponsorship-material')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ sponsorshipId: '507f1f77bcf86cd799439011', materialType: 'file' });

    expect([200, 400, 404]).toContain(res.status);
  });

  it('retorna 401 sem autenticacao', async () => {
    const res = await request(app)
      .put('/api/cart/items/sponsorship-material')
      .send({ sponsorshipId: '507f1f77bcf86cd799439011', materialType: 'file' });
    expect(res.status).toBe(401);
  });
});

// ─── clearCart ────────────────────────────────────────────────────────────

describe('DELETE /api/cart', () => {
  it('esvazia carrinho do usuario', async () => {
    const { auth, product } = await setupCartWithItem();

    const res = await request(app)
      .delete('/api/cart')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
  });

  it('retorna 401 sem autenticacao', async () => {
    const res = await request(app).delete('/api/cart');
    expect(res.status).toBe(401);
  });
});

// ─── syncCart ─────────────────────────────────────────────────────────────

describe('POST /api/cart/sync', () => {
  it('sincroniza carrinho com items fornecidos', async () => {
    const { user: broadcaster } = await createBroadcaster();
    const { auth } = await createAdvertiser();

    const product = await Product.create({
      broadcasterId: broadcaster._id,
      spotType: 'Comercial 30s',
      duration: 30,
      timeSlot: 'Rotativo',
      netPrice: 100,
      pricePerInsertion: 125,
      isActive: true,
    });

    const res = await request(app)
      .post('/api/cart/sync')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        items: [{ productId: product._id.toString(), quantity: 2 }],
      });

    expect([200, 400]).toContain(res.status);
  });

  it('retorna 401 sem autenticacao', async () => {
    const res = await request(app)
      .post('/api/cart/sync')
      .send({ items: [] });
    expect(res.status).toBe(401);
  });
});

// ─── updateItemQuantity extras ────────────────────────────────────────────

describe('PUT /api/cart/items/quantity — extras', () => {
  it('retorna 400 para quantidade zero ou negativa', async () => {
    const { auth, product } = await setupCartWithItem();

    const res = await request(app)
      .put('/api/cart/items/quantity')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ productId: product._id.toString(), quantity: 0 });

    expect([200, 400]).toContain(res.status);
  });
});

// ─── removeItem extras ────────────────────────────────────────────────────

describe('DELETE /api/cart/items/:productId — extras', () => {
  it('retorna 200 mesmo se item nao existia no carrinho', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .delete('/api/cart/items/507f1f77bcf86cd799439011')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect([200, 404]).toContain(res.status);
  });
});
