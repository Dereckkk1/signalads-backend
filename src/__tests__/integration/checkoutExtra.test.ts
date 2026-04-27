/**
 * Integration Tests — Checkout API (branches extras)
 * Cobre: sponsorship checkout, user not found, production cost, mês ausente
 */

import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';
import mongoose from 'mongoose';
import express from 'express';
import cookieParser from 'cookie-parser';

import { mongoSanitize, xssSanitize, dedupeQuery } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';
import paymentRoutes from '../../routes/paymentRoutes';

import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { createAdvertiser, createBroadcaster, createAgency } from '../helpers/authHelper';
import { Product } from '../../models/Product';
import { Sponsorship } from '../../models/Sponsorship';
import { Cart } from '../../models/Cart';
import { User } from '../../models/User';

function createCheckoutTestApp(): Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(mongoSanitize);
  app.use(xssSanitize);
  app.use(dedupeQuery);
  app.use(csrfProtection);
  app.use('/api/payment', paymentRoutes);
  app.use((_req, res) => { res.status(404).json({ error: 'Rota nao encontrada' }); });
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
  app = createCheckoutTestApp();
});

afterEach(async () => {
  await clearTestDB();
});

afterAll(async () => {
  await disconnectTestDB();
});

function nextMonthStr(offset = 2) {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

describe('POST /api/payment/checkout — patrocinio', () => {
  it('cria pedido com patrocinio no carrinho', async () => {
    const { user: buyer, auth } = await createAdvertiser();
    const { user: broadcaster } = await createBroadcaster();
    const selectedMonth = nextMonthStr();

    const sponsorship = await Sponsorship.create({
      broadcasterId: broadcaster._id,
      programName: 'Matinal FM',
      timeRange: { start: '06:00', end: '09:00' },
      daysOfWeek: [1, 2, 3, 4, 5],
      insertions: [{ name: 'Citacao', duration: 0, quantityPerDay: 1, requiresMaterial: false }],
      netPrice: 400,
      pricePerMonth: 500,
      isActive: true,
    });

    await Cart.create({
      userId: buyer._id,
      items: [{
        productId: sponsorship._id,
        itemType: 'sponsorship',
        productName: 'Matinal FM',
        productSchedule: '06:00 as 09:00',
        broadcasterId: broadcaster._id,
        broadcasterName: 'Radio Test FM',
        broadcasterDial: '100.1',
        broadcasterBand: 'FM',
        broadcasterLogo: '',
        broadcasterCity: 'Sao Paulo',
        price: 500,
        quantity: 1,
        duration: 0,
        addedAt: new Date(),
        selectedMonth,
      }],
    });

    const res = await request(app)
      .post('/api/payment/checkout')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.order).toBeDefined();
    const item = res.body.order.items.find((i: any) => i.itemType === 'sponsorship');
    expect(item).toBeDefined();
    expect(item.programName).toBe('Matinal FM');
    expect(item.selectedMonth).toBe(selectedMonth);
  });

  it('retorna 400 quando patrocinio nao tem selectedMonth', async () => {
    const { user: buyer, auth } = await createAdvertiser();
    const { user: broadcaster } = await createBroadcaster();

    const sponsorship = await Sponsorship.create({
      broadcasterId: broadcaster._id,
      programName: 'Vespertino',
      timeRange: { start: '14:00', end: '17:00' },
      daysOfWeek: [1, 2, 3],
      insertions: [{ name: 'Spot', duration: 30, quantityPerDay: 1, requiresMaterial: false }],
      netPrice: 300,
      pricePerMonth: 375,
      isActive: true,
    });

    await Cart.create({
      userId: buyer._id,
      items: [{
        productId: sponsorship._id,
        itemType: 'sponsorship',
        productName: 'Vespertino',
        productSchedule: '14:00 as 17:00',
        broadcasterId: broadcaster._id,
        broadcasterName: 'Radio',
        broadcasterDial: '', broadcasterBand: '', broadcasterLogo: '', broadcasterCity: '',
        price: 375,
        quantity: 1,
        duration: 0,
        addedAt: new Date(),
        // sem selectedMonth!
      }],
    });

    const res = await request(app)
      .post('/api/payment/checkout')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/mês não selecionado/i);
  });

  it('retorna 400 quando patrocinio foi inativado apos ser adicionado ao carrinho', async () => {
    const { user: buyer, auth } = await createAdvertiser();
    const { user: broadcaster } = await createBroadcaster();
    const selectedMonth = nextMonthStr();

    const sponsorship = await Sponsorship.create({
      broadcasterId: broadcaster._id,
      programName: 'Inativado',
      timeRange: { start: '08:00', end: '10:00' },
      daysOfWeek: [1, 2, 3, 4, 5],
      insertions: [{ name: 'Citacao', duration: 0, quantityPerDay: 1, requiresMaterial: false }],
      netPrice: 200,
      pricePerMonth: 250,
      isActive: true,
    });

    await Cart.create({
      userId: buyer._id,
      items: [{
        productId: sponsorship._id,
        itemType: 'sponsorship',
        productName: 'Inativado',
        productSchedule: '08:00 as 10:00',
        broadcasterId: broadcaster._id,
        broadcasterName: 'Radio',
        broadcasterDial: '', broadcasterBand: '', broadcasterLogo: '', broadcasterCity: '',
        price: 250,
        quantity: 1,
        duration: 0,
        addedAt: new Date(),
        selectedMonth,
      }],
    });

    // Inativa o patrocínio
    await Sponsorship.findByIdAndUpdate(sponsorship._id, { isActive: false });

    const res = await request(app)
      .post('/api/payment/checkout')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Patrocínio|não encontrado/i);
  });

  it('cria pedido com mix de produto + patrocinio', async () => {
    const { user: buyer, auth } = await createAdvertiser();
    const { user: broadcaster } = await createBroadcaster();
    const selectedMonth = nextMonthStr();

    const product = await Product.create({
      broadcasterId: broadcaster._id,
      spotType: 'Spot 30s',
      duration: 30,
      timeSlot: 'Rotativo',
      netPrice: 100,
      pricePerInsertion: 125,
      isActive: true,
    });

    const sponsorship = await Sponsorship.create({
      broadcasterId: broadcaster._id,
      programName: 'Programa Mix',
      timeRange: { start: '10:00', end: '12:00' },
      daysOfWeek: [1, 2, 3, 4, 5],
      insertions: [{ name: 'Citacao', duration: 0, quantityPerDay: 1, requiresMaterial: false }],
      netPrice: 300,
      pricePerMonth: 375,
      isActive: true,
    });

    await Cart.create({
      userId: buyer._id,
      items: [
        {
          productId: product._id,
          productName: 'Spot 30s',
          productSchedule: 'Rotativo',
          broadcasterId: broadcaster._id,
          broadcasterName: 'Radio',
          broadcasterDial: '', broadcasterBand: '', broadcasterLogo: '', broadcasterCity: '',
          price: 125, quantity: 5, duration: 30, addedAt: new Date(),
        },
        {
          productId: sponsorship._id,
          itemType: 'sponsorship',
          productName: 'Programa Mix',
          productSchedule: '10:00 as 12:00',
          broadcasterId: broadcaster._id,
          broadcasterName: 'Radio',
          broadcasterDial: '', broadcasterBand: '', broadcasterLogo: '', broadcasterCity: '',
          price: 375, quantity: 1, duration: 0, addedAt: new Date(),
          selectedMonth,
        },
      ],
    });

    const res = await request(app)
      .post('/api/payment/checkout')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.order.items).toHaveLength(2);
  });
});

describe('POST /api/payment/checkout — custo de producao', () => {
  it('adiciona custo de producao (R$50) para material tipo recording', async () => {
    const { user: buyer, auth } = await createAdvertiser();
    const { user: broadcaster } = await createBroadcaster();

    const product = await Product.create({
      broadcasterId: broadcaster._id,
      spotType: 'Spot Gravado',
      duration: 30,
      timeSlot: 'Rotativo',
      netPrice: 100,
      pricePerInsertion: 125,
      isActive: true,
    });

    await Cart.create({
      userId: buyer._id,
      items: [{
        productId: product._id,
        productName: 'Spot Gravado',
        productSchedule: 'Rotativo',
        broadcasterId: broadcaster._id,
        broadcasterName: 'Radio',
        broadcasterDial: '', broadcasterBand: '', broadcasterLogo: '', broadcasterCity: '',
        price: 125, quantity: 5, duration: 30, addedAt: new Date(),
        material: {
          type: 'recording',
          contentHash: 'hash-unico-abc123',
          script: 'Venha conferir',
          phonetic: '',
          voiceGender: 'female',
          musicStyle: 'corporativo',
        },
      }],
    });

    const res = await request(app)
      .post('/api/payment/checkout')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({});

    expect(res.status).toBe(201);
    // totalAmount inclui producao (R$50 por gravacao unica) alem dos produtos
    // grossAmount = 125*5 = 625, producao = 50 → total > 625
    expect(res.body.order.totalAmount).toBeGreaterThan(125 * 5);
  });
});

describe('POST /api/payment/checkout — agencia com clientId', () => {
  it('aceita clientId no checkout da agencia', async () => {
    const { user: buyer, auth } = await createAgency();
    const { user: broadcaster } = await createBroadcaster();
    const clientId = new mongoose.Types.ObjectId();

    const product = await Product.create({
      broadcasterId: broadcaster._id,
      spotType: 'Spot 30s',
      duration: 30,
      timeSlot: 'Rotativo',
      netPrice: 100,
      pricePerInsertion: 125,
      isActive: true,
    });

    await Cart.create({
      userId: buyer._id,
      items: [{
        productId: product._id,
        productName: 'Spot 30s',
        productSchedule: 'Rotativo',
        broadcasterId: broadcaster._id,
        broadcasterName: 'Radio',
        broadcasterDial: '', broadcasterBand: '', broadcasterLogo: '', broadcasterCity: '',
        price: 125, quantity: 3, duration: 30, addedAt: new Date(),
      }],
    });

    const res = await request(app)
      .post('/api/payment/checkout')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ agencyCommission: 10, clientId: clientId.toString() });

    expect(res.status).toBe(201);
    // clientId nao e retornado no response body — verificar no banco
    const Order = (await import('../../models/Order')).default;
    const savedOrder = await Order.findById(res.body.order._id);
    expect(savedOrder!.clientId?.toString()).toBe(clientId.toString());
    expect(savedOrder!.agencyCommission).toBeGreaterThan(0);
  });
});

describe('POST /api/payment/checkout — usuario nao encontrado', () => {
  it('retorna 401 quando usuario foi deletado (auth middleware rejeita primeiro)', async () => {
    const { user: buyer, auth } = await createAdvertiser();
    const { user: broadcaster } = await createBroadcaster();

    const product = await Product.create({
      broadcasterId: broadcaster._id,
      spotType: 'Spot 30s',
      duration: 30,
      timeSlot: 'Rotativo',
      netPrice: 100,
      pricePerInsertion: 125,
      isActive: true,
    });

    await Cart.create({
      userId: buyer._id,
      items: [{
        productId: product._id,
        productName: 'Spot 30s',
        productSchedule: 'Rotativo',
        broadcasterId: broadcaster._id,
        broadcasterName: 'Radio',
        broadcasterDial: '', broadcasterBand: '', broadcasterLogo: '', broadcasterCity: '',
        price: 125, quantity: 1, duration: 30, addedAt: new Date(),
      }],
    });

    // Deleta o usuario
    await User.findByIdAndDelete(buyer._id);

    const res = await request(app)
      .post('/api/payment/checkout')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({});

    // Auth middleware retorna 401 quando usuario nao existe no banco
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/usuário/i);
  });
});
