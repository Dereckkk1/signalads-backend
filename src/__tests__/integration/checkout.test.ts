/**
 * Integration Tests — Checkout API
 *
 * Tests real HTTP endpoints end-to-end.
 * POST   /api/payment/checkout
 */

// Mock do asaasService — isola testes do gateway real.
jest.mock('../../services/asaasService', () => ({
  getOrCreateCustomer: jest.fn().mockResolvedValue('cus_test'),
  createCreditCardCharge: jest.fn().mockResolvedValue({
    asaasPaymentId: 'pay_cc_1',
    status: 'CONFIRMED',
    invoiceUrl: 'https://sandbox.asaas.com/i/cc',
    cardBrand: 'VISA',
    cardLastDigits: '1111',
  }),
  createPixCharge: jest.fn().mockResolvedValue({
    asaasPaymentId: 'pay_pix_1',
    status: 'PENDING',
    invoiceUrl: 'https://sandbox.asaas.com/i/pix',
  }),
  getPixQrCode: jest.fn().mockResolvedValue({
    pixQrCode: 'base64img',
    pixCopyPaste: '00020126',
    expiresAt: '2026-05-22',
  }),
  sanitizeForLog: jest.fn((x: any) => x),
}));

import '../helpers/mocks';
import * as asaasService from '../../services/asaasService';

import request from 'supertest';
import { Application } from 'express';
import mongoose from 'mongoose';
import express from 'express';
import cookieParser from 'cookie-parser';

import { mongoSanitize, xssSanitize, dedupeQuery } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';
import paymentRoutes from '../../routes/paymentRoutes';

import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import {
  createAdvertiser,
  createBroadcaster,
  createAgency,
  createAdmin,
} from '../helpers/authHelper';
import { Product } from '../../models/Product';
import { Cart } from '../../models/Cart';
import Order from '../../models/Order';

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
  app = createCheckoutTestApp();
});

afterEach(async () => {
  await clearTestDB();
});

afterAll(async () => {
  await disconnectTestDB();
});

/**
 * Helper: creates a broadcaster with products and fills a cart for the buyer.
 */
async function createCartWithItems(buyerRole: 'advertiser' | 'agency' = 'advertiser') {
  const createBuyer = buyerRole === 'advertiser' ? createAdvertiser : createAgency;
  const { user: buyer, auth: buyerAuth } = await createBuyer();
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

  const cart = await Cart.create({
    userId: buyer._id,
    items: [
      {
        productId: product._id,
        productName: 'Comercial 30s',
        productSchedule: 'Rotativo',
        broadcasterId: broadcaster._id,
        broadcasterName: 'Radio Test FM',
        broadcasterDial: '100.1',
        broadcasterBand: 'FM',
        broadcasterLogo: '',
        broadcasterCity: 'Sao Paulo',
        price: 125,
        quantity: 10,
        duration: 30,
        addedAt: new Date(),
      },
    ],
  });

  return { buyer, buyerAuth, broadcaster, product, cart };
}

// ─────────────────────────────────────────────────
// POST /api/payment/checkout
// ─────────────────────────────────────────────────
describe('POST /api/payment/checkout', () => {
  it('should create an order from cart for advertiser', async () => {
    const { buyerAuth } = await createCartWithItems('advertiser');

    const res = await request(app)
      .post('/api/payment/checkout')
      .set('Cookie', buyerAuth.cookieHeader)
      .set('X-CSRF-Token', buyerAuth.csrfHeader)
      .send({ paymentMethod: 'pending_contact' });

    expect(res.status).toBe(201);
    expect(res.body.order).toBeDefined();
    expect(res.body.order.orderNumber).toMatch(/^ORD-/);
    expect(res.body.order.status).toBe('pending_contact');
    expect(res.body.order.items).toHaveLength(1);
    expect(res.body.order.totalAmount).toBeGreaterThan(0);
  });

  it('should create an order from cart for agency', async () => {
    const { buyerAuth } = await createCartWithItems('agency');

    const res = await request(app)
      .post('/api/payment/checkout')
      .set('Cookie', buyerAuth.cookieHeader)
      .set('X-CSRF-Token', buyerAuth.csrfHeader)
      .send({ paymentMethod: 'pending_contact' });

    expect(res.status).toBe(201);
    expect(res.body.order).toBeDefined();
    expect(res.body.order.status).toBe('pending_contact');
  });

  it('should clear the cart after successful checkout', async () => {
    const { buyer, buyerAuth, cart } = await createCartWithItems();

    const res = await request(app)
      .post('/api/payment/checkout')
      .set('Cookie', buyerAuth.cookieHeader)
      .set('X-CSRF-Token', buyerAuth.csrfHeader)
      .send({ paymentMethod: 'pending_contact' });

    expect(res.status).toBe(201);

    // Cart should be empty now
    const updatedCart = await Cart.findById(cart._id);
    expect(updatedCart!.items).toHaveLength(0);
  });

  it('should reject when cart is empty', async () => {
    const { user: advertiser, auth } = await createAdvertiser();

    // Create an empty cart
    await Cart.create({ userId: advertiser._id, items: [] });

    const res = await request(app)
      .post('/api/payment/checkout')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ paymentMethod: 'pending_contact' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/vazio|checkout/i);
  });

  it('should reject when no cart exists', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .post('/api/payment/checkout')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ paymentMethod: 'pending_contact' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/vazio|checkout/i);
  });

  it('should reject when broadcaster tries to checkout', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/payment/checkout')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ paymentMethod: 'pending_contact' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/anunciantes|agências/i);
  });

  it('should reject when admin tries to checkout', async () => {
    const { auth } = await createAdmin();

    const res = await request(app)
      .post('/api/payment/checkout')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ paymentMethod: 'pending_contact' });

    expect(res.status).toBe(403);
  });

  it('should return 401 when unauthenticated', async () => {
    const res = await request(app)
      .post('/api/payment/checkout')
      .send({ paymentMethod: 'pending_contact' });

    expect(res.status).toBe(401);
  });

  it('should prevent double checkout (atomicity)', async () => {
    const { buyerAuth } = await createCartWithItems();

    // First checkout should succeed
    const res1 = await request(app)
      .post('/api/payment/checkout')
      .set('Cookie', buyerAuth.cookieHeader)
      .set('X-CSRF-Token', buyerAuth.csrfHeader)
      .send({ paymentMethod: 'pending_contact' });

    expect(res1.status).toBe(201);

    // Second checkout should fail (cart already empty)
    const res2 = await request(app)
      .post('/api/payment/checkout')
      .set('Cookie', buyerAuth.cookieHeader)
      .set('X-CSRF-Token', buyerAuth.csrfHeader)
      .send({ paymentMethod: 'pending_contact' });

    expect(res2.status).toBe(400);
    expect(res2.body.error).toMatch(/vazio|checkout/i);
  });

  it('should calculate correct financial amounts', async () => {
    const { buyerAuth, product } = await createCartWithItems();

    const res = await request(app)
      .post('/api/payment/checkout')
      .set('Cookie', buyerAuth.cookieHeader)
      .set('X-CSRF-Token', buyerAuth.csrfHeader)
      .send({ paymentMethod: 'pending_contact' });

    expect(res.status).toBe(201);

    // Verify financial calculation in the created order
    const order = await Order.findById(res.body.order._id);
    expect(order).not.toBeNull();

    // 10 items * 125 each = 1250
    expect(order!.grossAmount).toBe(1250);
    // broadcasterAmount = 75% of grossAmount = 937.5
    expect(order!.broadcasterAmount).toBe(937.5);
    // platformSplit = 20% of grossAmount = 250
    expect(order!.platformSplit).toBe(250);
    // techFee = 5% of grossAmount = 62.5
    expect(order!.techFee).toBe(62.5);
  });

  it('should reject agency commission from non-agency user', async () => {
    const { buyerAuth } = await createCartWithItems('advertiser');

    const res = await request(app)
      .post('/api/payment/checkout')
      .set('Cookie', buyerAuth.cookieHeader)
      .set('X-CSRF-Token', buyerAuth.csrfHeader)
      .send({ paymentMethod: 'pending_contact', agencyCommission: 10 });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/agências/i);
  });

  it('should accept agency commission from agency user', async () => {
    const { buyerAuth } = await createCartWithItems('agency');

    const res = await request(app)
      .post('/api/payment/checkout')
      .set('Cookie', buyerAuth.cookieHeader)
      .set('X-CSRF-Token', buyerAuth.csrfHeader)
      .send({ paymentMethod: 'pending_contact', agencyCommission: 10 });

    expect(res.status).toBe(201);
    expect(res.body.order).toBeDefined();

    const order = await Order.findById(res.body.order._id);
    // agencyCommission is stored as monetary amount, not percentage
    // grossAmount = 10 items * R$125 = R$1250, commission = 1250 * (10/100) = R$125
    expect(order!.agencyCommission).toBe(125);
  });

  it('should reject agency commission above 30%', async () => {
    const { buyerAuth } = await createCartWithItems('agency');

    const res = await request(app)
      .post('/api/payment/checkout')
      .set('Cookie', buyerAuth.cookieHeader)
      .set('X-CSRF-Token', buyerAuth.csrfHeader)
      .send({ paymentMethod: 'pending_contact', agencyCommission: 35 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/0 e 30%/i);
  });

  it('should handle monitoring cost when enabled', async () => {
    const { buyerAuth } = await createCartWithItems('advertiser');

    const res = await request(app)
      .post('/api/payment/checkout')
      .set('Cookie', buyerAuth.cookieHeader)
      .set('X-CSRF-Token', buyerAuth.csrfHeader)
      .send({ paymentMethod: 'pending_contact', isMonitoringEnabled: true });

    expect(res.status).toBe(201);

    const order = await Order.findById(res.body.order._id);
    expect(order!.isMonitoringEnabled).toBe(true);
    // 1 broadcaster * R$70 = 70
    expect(order!.monitoringCost).toBe(70);
  });

  it('should reject checkout when product becomes unavailable', async () => {
    const { buyerAuth, product } = await createCartWithItems();

    // Deactivate the product after cart was created
    await Product.findByIdAndUpdate(product._id, { isActive: false });

    const res = await request(app)
      .post('/api/payment/checkout')
      .set('Cookie', buyerAuth.cookieHeader)
      .set('X-CSRF-Token', buyerAuth.csrfHeader)
      .send({ paymentMethod: 'pending_contact' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/não encontrado|indisponível/i);
  });

  // ───────────────────────────────────────────────────────────────────
  // Asaas payment methods (Fase 3)
  // ───────────────────────────────────────────────────────────────────

  describe('paymentMethod validation', () => {
    afterEach(() => {
      jest.clearAllMocks();
    });

    it('should reject when paymentMethod is missing', async () => {
      const { buyerAuth } = await createCartWithItems('advertiser');

      const res = await request(app)
        .post('/api/payment/checkout')
        .set('Cookie', buyerAuth.cookieHeader)
        .set('X-CSRF-Token', buyerAuth.csrfHeader)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/método de pagamento/i);
    });

    it('should reject when paymentMethod is invalid', async () => {
      const { buyerAuth } = await createCartWithItems('advertiser');

      const res = await request(app)
        .post('/api/payment/checkout')
        .set('Cookie', buyerAuth.cookieHeader)
        .set('X-CSRF-Token', buyerAuth.csrfHeader)
        .send({ paymentMethod: 'bitcoin' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/método de pagamento/i);
    });

    it('should reject credit_card without card data', async () => {
      const { buyerAuth } = await createCartWithItems('advertiser');

      const res = await request(app)
        .post('/api/payment/checkout')
        .set('Cookie', buyerAuth.cookieHeader)
        .set('X-CSRF-Token', buyerAuth.csrfHeader)
        .send({ paymentMethod: 'credit_card' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/cartão/i);
    });
  });

  describe('credit_card flow', () => {
    afterEach(() => {
      jest.clearAllMocks();
    });

    const validCard = {
      number: '4111 1111 1111 1111',
      holderName: 'Test Holder',
      expiryMonth: '12',
      expiryYear: '2030',
      ccv: '123',
      cpfCnpj: '123.456.789-09',
    };

    it('should create paid order with credit_card (happy path)', async () => {
      const { buyerAuth } = await createCartWithItems('advertiser');

      const res = await request(app)
        .post('/api/payment/checkout')
        .set('Cookie', buyerAuth.cookieHeader)
        .set('X-CSRF-Token', buyerAuth.csrfHeader)
        .send({
          paymentMethod: 'credit_card',
          card: validCard,
          installments: 3,
        });

      expect(res.status).toBe(201);
      expect(res.body.order.status).toBe('paid');
      expect(res.body.order.payment.method).toBe('credit_card');
      expect(res.body.order.payment.status).toBe('received');
      expect(res.body.order.payment.cardBrand).toBe('VISA');
      expect(res.body.order.payment.cardLastDigits).toBe('1111');
      expect(res.body.order.payment.installments).toBe(3);
      expect(res.body.message).toMatch(/aprovado/i);

      // Validate Asaas was called with sanitized digit-only cpfCnpj
      expect(asaasService.getOrCreateCustomer).toHaveBeenCalled();
      expect(asaasService.createCreditCardCharge).toHaveBeenCalledTimes(1);
      const callArg = (asaasService.createCreditCardCharge as jest.Mock).mock.calls[0][0];
      expect(callArg.creditCard.number).toBe('4111111111111111');
      expect(callArg.creditCardHolderInfo.cpfCnpj).toBe('12345678909');
      expect(callArg.installmentCount).toBe(3);

      // Order should be persisted with payment info
      const persisted = await Order.findById(res.body.order._id);
      expect(persisted!.status).toBe('paid');
      expect(persisted!.payment.asaasPaymentId).toBe('pay_cc_1');
    });

    it('should rollback cart and return 402 when card is declined', async () => {
      (asaasService.createCreditCardCharge as jest.Mock).mockRejectedValueOnce(
        new Error('Cartão recusado pelo banco emissor')
      );

      const { buyerAuth, cart } = await createCartWithItems('advertiser');

      const res = await request(app)
        .post('/api/payment/checkout')
        .set('Cookie', buyerAuth.cookieHeader)
        .set('X-CSRF-Token', buyerAuth.csrfHeader)
        .send({
          paymentMethod: 'credit_card',
          card: validCard,
        });

      expect(res.status).toBe(402);
      expect(res.body.error).toMatch(/recusado/i);

      // Cart should be released for retry (checkedOut=false, items preserved)
      const updatedCart = await Cart.findById(cart._id);
      expect((updatedCart as any).checkedOut).toBeFalsy();
      expect(updatedCart!.items.length).toBeGreaterThan(0);
    });
  });

  describe('pix flow', () => {
    afterEach(() => {
      jest.clearAllMocks();
    });

    it('should create pending_payment order with PIX (happy path)', async () => {
      const { buyerAuth } = await createCartWithItems('advertiser');

      const res = await request(app)
        .post('/api/payment/checkout')
        .set('Cookie', buyerAuth.cookieHeader)
        .set('X-CSRF-Token', buyerAuth.csrfHeader)
        .send({ paymentMethod: 'pix' });

      expect(res.status).toBe(201);
      expect(res.body.order.status).toBe('pending_payment');
      expect(res.body.order.payment.method).toBe('pix');
      expect(res.body.order.payment.status).toBe('pending');
      expect(res.body.order.payment.pixQrCode).toBe('base64img');
      expect(res.body.order.payment.pixCopyPaste).toBe('00020126');
      expect(res.body.redirectTo).toMatch(/^\/orders\//);

      expect(asaasService.createPixCharge).toHaveBeenCalledTimes(1);
      expect(asaasService.getPixQrCode).toHaveBeenCalledWith('pay_pix_1');
    });
  });

  describe('pending_contact regression', () => {
    afterEach(() => {
      jest.clearAllMocks();
    });

    it('should NOT call Asaas for pending_contact', async () => {
      const { buyerAuth } = await createCartWithItems('advertiser');

      const res = await request(app)
        .post('/api/payment/checkout')
        .set('Cookie', buyerAuth.cookieHeader)
        .set('X-CSRF-Token', buyerAuth.csrfHeader)
        .send({ paymentMethod: 'pending_contact' });

      expect(res.status).toBe(201);
      expect(res.body.order.status).toBe('pending_contact');
      expect(res.body.order.payment.method).toBe('pending_contact');

      // Asaas should NOT have been touched
      expect(asaasService.getOrCreateCustomer).not.toHaveBeenCalled();
      expect(asaasService.createCreditCardCharge).not.toHaveBeenCalled();
      expect(asaasService.createPixCharge).not.toHaveBeenCalled();
      expect(asaasService.getPixQrCode).not.toHaveBeenCalled();
    });
  });
});
