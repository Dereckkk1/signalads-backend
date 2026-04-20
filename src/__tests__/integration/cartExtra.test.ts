/**
 * Integration Tests — Cart API (branches extras)
 * Cobre os branches descobertos: sponsorship paths, 404 paths, validações
 */

import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';
import mongoose from 'mongoose';

import { createTestApp } from '../helpers/createTestApp';
import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { createAdvertiser, createBroadcaster } from '../helpers/authHelper';
import { Product } from '../../models/Product';
import { Cart } from '../../models/Cart';
import { Sponsorship } from '../../models/Sponsorship';
import { User } from '../../models/User';

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

async function createBroadcasterWithProduct() {
  const { user: broadcaster } = await createBroadcaster();
  const product = await Product.create({
    broadcasterId: broadcaster._id,
    spotType: 'Comercial 30s',
    duration: 30,
    timeSlot: 'Rotativo',
    netPrice: 100,
    pricePerInsertion: 125,
    isActive: true,
  });
  return { broadcaster, product };
}

async function createSponsorshipSetup() {
  const { user: broadcaster } = await createBroadcaster();
  const sponsorship = await Sponsorship.create({
    broadcasterId: broadcaster._id,
    programName: 'Show da Tarde',
    timeRange: { start: '14:00', end: '17:00' },
    daysOfWeek: [1, 2, 3, 4, 5],
    insertions: [{ name: 'Citacao', duration: 0, quantityPerDay: 2, requiresMaterial: false }],
    netPrice: 400,
    pricePerMonth: 500,
    isActive: true,
  });
  return { broadcaster, sponsorship };
}

function nextMonthStr(offset = 2) {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ═══════════════════════════════════════════════════════════════
// POST /api/cart/items — emissora nao aprovada
// ═══════════════════════════════════════════════════════════════
describe('POST /api/cart/items — broadcaster nao aprovado', () => {
  it('retorna 400 quando emissora do produto esta com status pending', async () => {
    const { auth } = await createAdvertiser();
    const { user: broadcaster } = await createBroadcaster();
    await User.findByIdAndUpdate(broadcaster._id, { status: 'pending' });

    const product = await Product.create({
      broadcasterId: broadcaster._id,
      spotType: 'Spot 30s',
      duration: 30,
      timeSlot: 'Rotativo',
      netPrice: 100,
      pricePerInsertion: 125,
      isActive: true,
    });

    const res = await request(app)
      .post('/api/cart/items')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ productId: product._id.toString(), quantity: 1 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/indisponível/i);
  });
});

// ═══════════════════════════════════════════════════════════════
// POST /api/cart/items — sponsorship paths
// ═══════════════════════════════════════════════════════════════
describe('POST /api/cart/items — patrocinio', () => {
  it('adiciona patrocinio novo ao carrinho', async () => {
    const { auth } = await createAdvertiser();
    const { sponsorship } = await createSponsorshipSetup();
    const selectedMonth = nextMonthStr();

    const res = await request(app)
      .post('/api/cart/items')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ sponsorshipId: sponsorship._id.toString(), selectedMonth });

    expect(res.status).toBe(200);
    const item = res.body.items.find((i: any) => i.itemType === 'sponsorship');
    expect(item).toBeDefined();
    expect(item.selectedMonth).toBe(selectedMonth);
  });

  it('atualiza mes quando patrocinio ja existe no carrinho', async () => {
    const { user: advertiser, auth } = await createAdvertiser();
    const { sponsorship } = await createSponsorshipSetup();
    const month1 = nextMonthStr(2);
    const month2 = nextMonthStr(3);

    await Cart.create({
      userId: advertiser._id,
      items: [{
        productId: sponsorship._id,
        itemType: 'sponsorship',
        productName: 'Show da Tarde',
        productSchedule: '14:00 as 17:00',
        broadcasterId: new mongoose.Types.ObjectId(),
        broadcasterName: 'Radio',
        broadcasterDial: '', broadcasterBand: '', broadcasterLogo: '', broadcasterCity: '',
        price: 500, quantity: 1, duration: 0, addedAt: new Date(),
        selectedMonth: month1,
      }],
    });

    const res = await request(app)
      .post('/api/cart/items')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ sponsorshipId: sponsorship._id.toString(), selectedMonth: month2 });

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].selectedMonth).toBe(month2);
  });

  it('retorna 404 para sponsorshipId inexistente', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .post('/api/cart/items')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ sponsorshipId: new mongoose.Types.ObjectId().toString(), selectedMonth: nextMonthStr() });

    expect(res.status).toBe(404);
  });

  it('retorna 400 para selectedMonth com formato invalido', async () => {
    const { auth } = await createAdvertiser();
    const { sponsorship } = await createSponsorshipSetup();

    const res = await request(app)
      .post('/api/cart/items')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ sponsorshipId: sponsorship._id.toString(), selectedMonth: '01/2027' });

    expect(res.status).toBe(400);
  });

  it('retorna 400 para selectedMonth no mes atual', async () => {
    const { auth } = await createAdvertiser();
    const { sponsorship } = await createSponsorshipSetup();
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const res = await request(app)
      .post('/api/cart/items')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ sponsorshipId: sponsorship._id.toString(), selectedMonth: currentMonth });

    expect(res.status).toBe(400);
  });

  it('adiciona sem selectedMonth (opcional no addItem)', async () => {
    const { auth } = await createAdvertiser();
    const { sponsorship } = await createSponsorshipSetup();

    const res = await request(app)
      .post('/api/cart/items')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ sponsorshipId: sponsorship._id.toString() });

    expect(res.status).toBe(200);
    const item = res.body.items.find((i: any) => i.itemType === 'sponsorship');
    expect(item).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// PUT /api/cart/items/quantity — branches 404
// ═══════════════════════════════════════════════════════════════
describe('PUT /api/cart/items/quantity — 404', () => {
  it('retorna 404 quando carrinho nao existe', async () => {
    const { auth } = await createAdvertiser();
    const { product } = await createBroadcasterWithProduct();

    const res = await request(app)
      .put('/api/cart/items/quantity')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ productId: product._id.toString(), quantity: 5 });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/carrinho/i);
  });

  it('retorna 404 quando item nao esta no carrinho', async () => {
    const { user: advertiser, auth } = await createAdvertiser();
    const { product } = await createBroadcasterWithProduct();
    await Cart.create({ userId: advertiser._id, items: [] });

    const res = await request(app)
      .put('/api/cart/items/quantity')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ productId: product._id.toString(), quantity: 5 });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/item/i);
  });

  it('retorna 400 para quantidade acima do limite (10000)', async () => {
    const { auth } = await createAdvertiser();
    const { product } = await createBroadcasterWithProduct();

    const res = await request(app)
      .put('/api/cart/items/quantity')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ productId: product._id.toString(), quantity: 10001 });

    expect(res.status).toBe(400);
  });

  it('retorna 400 para quantidade zero', async () => {
    const { auth } = await createAdvertiser();
    const { product } = await createBroadcasterWithProduct();

    const res = await request(app)
      .put('/api/cart/items/quantity')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ productId: product._id.toString(), quantity: 0 });

    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════
// PUT /api/cart/items/schedule — branches 404
// ═══════════════════════════════════════════════════════════════
describe('PUT /api/cart/items/schedule — 404', () => {
  it('retorna 404 quando carrinho nao existe', async () => {
    const { auth } = await createAdvertiser();
    const { product } = await createBroadcasterWithProduct();

    const res = await request(app)
      .put('/api/cart/items/schedule')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ productId: product._id.toString(), schedule: { 'seg-sex': 5 } });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/carrinho/i);
  });

  it('retorna 404 quando item nao esta no carrinho', async () => {
    const { user: advertiser, auth } = await createAdvertiser();
    const { product } = await createBroadcasterWithProduct();
    await Cart.create({ userId: advertiser._id, items: [] });

    const res = await request(app)
      .put('/api/cart/items/schedule')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ productId: product._id.toString(), schedule: { 'seg-sex': 5 } });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/item/i);
  });
});

// ═══════════════════════════════════════════════════════════════
// PUT /api/cart/items/material — branches 404 e validacao filename
// ═══════════════════════════════════════════════════════════════
describe('PUT /api/cart/items/material — 404 e validacao', () => {
  it('retorna 404 quando carrinho nao existe', async () => {
    const { auth } = await createAdvertiser();
    const { product } = await createBroadcasterWithProduct();

    const res = await request(app)
      .put('/api/cart/items/material')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ productId: product._id.toString(), material: { type: 'text', text: 'Ola' } });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/carrinho/i);
  });

  it('retorna 404 quando item nao esta no carrinho', async () => {
    const { user: advertiser, auth } = await createAdvertiser();
    const { product } = await createBroadcasterWithProduct();
    await Cart.create({ userId: advertiser._id, items: [] });

    const res = await request(app)
      .put('/api/cart/items/material')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ productId: product._id.toString(), material: { type: 'text', text: 'Ola' } });

    expect(res.status).toBe(404);
  });

  it('retorna 400 para audioFileName com path traversal', async () => {
    const { user: advertiser, auth } = await createAdvertiser();
    const { product } = await createBroadcasterWithProduct();

    await Cart.create({
      userId: advertiser._id,
      items: [{
        productId: product._id,
        productName: 'P', productSchedule: 'Rotativo',
        broadcasterId: new mongoose.Types.ObjectId(),
        broadcasterName: '', broadcasterDial: '', broadcasterBand: '', broadcasterLogo: '', broadcasterCity: '',
        price: 125, quantity: 1, duration: 30, addedAt: new Date(),
      }],
    });

    const res = await request(app)
      .put('/api/cart/items/material')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        productId: product._id.toString(),
        material: {
          type: 'audio',
          audioUrl: 'https://storage.com/audio.mp3',
          audioFileName: '../../../etc/passwd',
        },
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/arquivo/i);
  });
});

// ═══════════════════════════════════════════════════════════════
// DELETE /api/cart/items/:productId — 404
// ═══════════════════════════════════════════════════════════════
describe('DELETE /api/cart/items/:productId — 404', () => {
  it('retorna 404 quando carrinho nao existe', async () => {
    const { auth } = await createAdvertiser();
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .delete(`/api/cart/items/${fakeId}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/carrinho/i);
  });
});

// ═══════════════════════════════════════════════════════════════
// DELETE /api/cart — 404
// ═══════════════════════════════════════════════════════════════
describe('DELETE /api/cart — 404', () => {
  it('retorna 404 quando carrinho nao existe', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .delete('/api/cart')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/carrinho/i);
  });
});

// ═══════════════════════════════════════════════════════════════
// POST /api/cart/sync — sponsorship sync path
// ═══════════════════════════════════════════════════════════════
describe('POST /api/cart/sync — patrocinio', () => {
  it('sincroniza patrocinio — usa preco do banco, nao do localStorage', async () => {
    const { auth } = await createAdvertiser();
    const { user: broadcaster } = await createBroadcaster();
    const sponsorship = await Sponsorship.create({
      broadcasterId: broadcaster._id,
      programName: 'Matinal',
      timeRange: { start: '06:00', end: '09:00' },
      daysOfWeek: [1, 2, 3, 4, 5],
      insertions: [{ name: 'Citacao', duration: 0, quantityPerDay: 1, requiresMaterial: false }],
      netPrice: 300,
      pricePerMonth: 375,
      isActive: true,
    });

    const selectedMonth = nextMonthStr();

    const res = await request(app)
      .post('/api/cart/sync')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        items: [{
          productId: sponsorship._id.toString(),
          itemType: 'sponsorship',
          selectedMonth,
          quantity: 1,
          price: 9999, // preco do localStorage — deve ser ignorado
        }],
      });

    expect(res.status).toBe(200);
    const item = res.body.items.find((i: any) => i.itemType === 'sponsorship');
    expect(item).toBeDefined();
    expect(item.price).toBe(375); // preco seguro do banco
  });

  it('descarta patrocinio inexistente no banco', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .post('/api/cart/sync')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        items: [{
          productId: new mongoose.Types.ObjectId().toString(),
          itemType: 'sponsorship',
          selectedMonth: nextMonthStr(),
          quantity: 1,
        }],
      });

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
  });
});
