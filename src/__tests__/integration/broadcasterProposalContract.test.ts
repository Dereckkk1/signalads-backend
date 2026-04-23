/**
 * Integration Tests — Contrato (condicoes de pagamento) e Payment Tags
 * Endpoints:
 * - POST   /api/broadcaster-proposals (com contract no body)
 * - PUT    /api/broadcaster-proposals/:id (atualizando contract)
 * - POST   /api/broadcaster-proposals/contract/preview-installments
 * - GET    /api/broadcaster-proposals/payment-tags
 * - POST   /api/broadcaster-proposals/payment-tags
 * - DELETE /api/broadcaster-proposals/payment-tags/:id
 */

import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';
import express from 'express';
import cookieParser from 'cookie-parser';
import hpp from 'hpp';

import { mongoSanitize, xssSanitize } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';
import broadcasterProposalRoutes from '../../routes/broadcasterProposalRoutes';

import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { createBroadcaster, createAdvertiser } from '../helpers/authHelper';
import { Product } from '../../models/Product';
import BroadcasterPaymentTag from '../../models/BroadcasterPaymentTag';

function createApp(): Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(mongoSanitize);
  app.use(xssSanitize);
  app.use(hpp());
  app.use(csrfProtection);
  app.use('/api/broadcaster-proposals', broadcasterProposalRoutes);
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
  app = createApp();
});

afterEach(async () => {
  await clearTestDB();
});

afterAll(async () => {
  await disconnectTestDB();
});

async function setupBroadcaster() {
  const { user: broadcaster, auth } = await createBroadcaster();
  const product = await Product.create({
    broadcasterId: broadcaster._id,
    spotType: 'Comercial 30s',
    duration: 30,
    timeSlot: 'Rotativo',
    netPrice: 100,
    pricePerInsertion: 125,
    isActive: true,
  });
  return { broadcaster, auth, product };
}

// ─────────────────────────────────────────────────
// POST /api/broadcaster-proposals (com contract)
// ─────────────────────────────────────────────────
describe('POST /api/broadcaster-proposals com contract', () => {
  it('cria proposta com contrato e gera contractNumber sequencial', async () => {
    const { broadcaster, auth, product } = await setupBroadcaster();

    const res = await request(app)
      .post('/api/broadcaster-proposals')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        title: 'Proposta com Contrato',
        clientName: 'Cliente Teste',
        items: [{ productId: product._id.toString(), broadcasterId: broadcaster._id.toString(), quantity: 10 }],
        contract: {
          installmentsCount: 3,
          firstDueDate: '2026-05-01',
          interval: { value: 30, unit: 'day' },
          carrier: 'Carteira',
          procedure: 'Nota Fiscal',
          description: 'Pagamento em 3x',
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.proposal.contract).toBeDefined();
    expect(res.body.proposal.contract.contractNumber).toMatch(/^CTR-[A-F0-9]{6}-\d{4}$/);
    expect(res.body.proposal.contract.installments).toHaveLength(3);
    expect(res.body.proposal.contract.totalValue).toBe(1000);
    expect(res.body.proposal.contract.carrier).toBe('Carteira');
  });

  it('numero do contrato eh sequencial por emissora', async () => {
    const { broadcaster, auth, product } = await setupBroadcaster();

    const base = {
      clientName: 'Cliente X',
      items: [{ productId: product._id.toString(), broadcasterId: broadcaster._id.toString(), quantity: 1 }],
      contract: {
        installmentsCount: 1,
        firstDueDate: '2026-05-01',
        interval: { value: 30, unit: 'day' },
      },
    };

    const r1 = await request(app).post('/api/broadcaster-proposals')
      .set('Cookie', auth.cookieHeader).set('X-CSRF-Token', auth.csrfHeader)
      .send({ ...base, title: 'P1' });
    const r2 = await request(app).post('/api/broadcaster-proposals')
      .set('Cookie', auth.cookieHeader).set('X-CSRF-Token', auth.csrfHeader)
      .send({ ...base, title: 'P2' });

    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    const seq1 = parseInt(r1.body.proposal.contract.contractNumber.split('-').pop(), 10);
    const seq2 = parseInt(r2.body.proposal.contract.contractNumber.split('-').pop(), 10);
    expect(seq2).toBe(seq1 + 1);
  });

  it('cria proposta sem contract quando nao enviado', async () => {
    const { broadcaster, auth, product } = await setupBroadcaster();

    const res = await request(app)
      .post('/api/broadcaster-proposals')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        title: 'Sem contrato',
        clientName: 'Cliente',
        items: [{ productId: product._id.toString(), broadcasterId: broadcaster._id.toString(), quantity: 1 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.proposal.contract).toBeFalsy();
  });
});

// ─────────────────────────────────────────────────
// PUT /api/broadcaster-proposals/:id (contract update)
// ─────────────────────────────────────────────────
describe('PUT /api/broadcaster-proposals/:id com contract', () => {
  it('adiciona contrato em proposta existente e gera numero', async () => {
    const { broadcaster, auth, product } = await setupBroadcaster();

    const createRes = await request(app).post('/api/broadcaster-proposals')
      .set('Cookie', auth.cookieHeader).set('X-CSRF-Token', auth.csrfHeader)
      .send({
        title: 'P',
        clientName: 'C',
        items: [{ productId: product._id.toString(), broadcasterId: broadcaster._id.toString(), quantity: 1 }],
      });

    const id = createRes.body.proposal._id;

    const updRes = await request(app).put(`/api/broadcaster-proposals/${id}`)
      .set('Cookie', auth.cookieHeader).set('X-CSRF-Token', auth.csrfHeader)
      .send({
        contract: {
          installmentsCount: 2,
          firstDueDate: '2026-06-01',
          interval: { value: 1, unit: 'month' },
        },
      });

    expect(updRes.status).toBe(200);
    expect(updRes.body.proposal.contract.contractNumber).toMatch(/^CTR-/);
    expect(updRes.body.proposal.contract.installments).toHaveLength(2);
  });

  it('preserva contractNumber existente ao editar contrato', async () => {
    const { broadcaster, auth, product } = await setupBroadcaster();

    const createRes = await request(app).post('/api/broadcaster-proposals')
      .set('Cookie', auth.cookieHeader).set('X-CSRF-Token', auth.csrfHeader)
      .send({
        title: 'P',
        clientName: 'C',
        items: [{ productId: product._id.toString(), broadcasterId: broadcaster._id.toString(), quantity: 1 }],
        contract: {
          installmentsCount: 2,
          firstDueDate: '2026-06-01',
          interval: { value: 30, unit: 'day' },
        },
      });

    const id = createRes.body.proposal._id;
    const originalNumber = createRes.body.proposal.contract.contractNumber;

    const updRes = await request(app).put(`/api/broadcaster-proposals/${id}`)
      .set('Cookie', auth.cookieHeader).set('X-CSRF-Token', auth.csrfHeader)
      .send({
        contract: {
          installmentsCount: 4, // muda qtd
          firstDueDate: '2026-06-01',
          interval: { value: 30, unit: 'day' },
        },
      });

    expect(updRes.status).toBe(200);
    expect(updRes.body.proposal.contract.contractNumber).toBe(originalNumber);
    expect(updRes.body.proposal.contract.installments).toHaveLength(4);
  });

  it('remove contrato quando contract=null', async () => {
    const { broadcaster, auth, product } = await setupBroadcaster();

    const createRes = await request(app).post('/api/broadcaster-proposals')
      .set('Cookie', auth.cookieHeader).set('X-CSRF-Token', auth.csrfHeader)
      .send({
        title: 'P', clientName: 'C',
        items: [{ productId: product._id.toString(), broadcasterId: broadcaster._id.toString(), quantity: 1 }],
        contract: {
          installmentsCount: 1, firstDueDate: '2026-05-01',
          interval: { value: 30, unit: 'day' },
        },
      });

    const id = createRes.body.proposal._id;

    const updRes = await request(app).put(`/api/broadcaster-proposals/${id}`)
      .set('Cookie', auth.cookieHeader).set('X-CSRF-Token', auth.csrfHeader)
      .send({ contract: null });

    expect(updRes.status).toBe(200);
    expect(updRes.body.proposal.contract).toBeFalsy();
  });
});

// ─────────────────────────────────────────────────
// POST /api/broadcaster-proposals/contract/preview-installments
// ─────────────────────────────────────────────────
describe('POST /api/broadcaster-proposals/contract/preview-installments', () => {
  it('calcula parcelas corretamente', async () => {
    const { auth } = await setupBroadcaster();

    const res = await request(app).post('/api/broadcaster-proposals/contract/preview-installments')
      .set('Cookie', auth.cookieHeader).set('X-CSRF-Token', auth.csrfHeader)
      .send({
        totalValue: 1000,
        installmentsCount: 4,
        firstDueDate: '2026-05-01',
        interval: { value: 30, unit: 'day' },
      });

    expect(res.status).toBe(200);
    expect(res.body.installments).toHaveLength(4);
    const sum = res.body.installments.reduce((s: number, i: any) => s + i.amount, 0);
    expect(parseFloat(sum.toFixed(2))).toBe(1000);
  });

  it('retorna 400 quando campos obrigatorios faltam', async () => {
    const { auth } = await setupBroadcaster();

    const res = await request(app).post('/api/broadcaster-proposals/contract/preview-installments')
      .set('Cookie', auth.cookieHeader).set('X-CSRF-Token', auth.csrfHeader)
      .send({ totalValue: 1000 });

    expect(res.status).toBe(400);
  });

  it('retorna 401 quando nao autenticado', async () => {
    const res = await request(app).post('/api/broadcaster-proposals/contract/preview-installments')
      .send({ totalValue: 100 });
    expect(res.status).toBe(401);
  });

  it('retorna 403 quando nao eh broadcaster', async () => {
    const { auth } = await createAdvertiser();
    const res = await request(app).post('/api/broadcaster-proposals/contract/preview-installments')
      .set('Cookie', auth.cookieHeader).set('X-CSRF-Token', auth.csrfHeader)
      .send({
        totalValue: 100, installmentsCount: 2, firstDueDate: '2026-05-01',
        interval: { value: 30, unit: 'day' },
      });
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────
// Payment Tags CRUD
// ─────────────────────────────────────────────────
describe('Payment Tags', () => {
  it('GET lista vazia quando nao ha tags', async () => {
    const { auth } = await setupBroadcaster();
    const res = await request(app).get('/api/broadcaster-proposals/payment-tags')
      .set('Cookie', auth.cookieHeader).set('X-CSRF-Token', auth.csrfHeader);
    expect(res.status).toBe(200);
    expect(res.body.tags).toEqual([]);
  });

  it('POST cria tag e GET retorna', async () => {
    const { auth } = await setupBroadcaster();

    const create = await request(app).post('/api/broadcaster-proposals/payment-tags')
      .set('Cookie', auth.cookieHeader).set('X-CSRF-Token', auth.csrfHeader)
      .send({ label: 'Nota de compra' });

    expect(create.status).toBe(201);
    expect(create.body.tag.label).toBe('Nota de compra');

    const list = await request(app).get('/api/broadcaster-proposals/payment-tags')
      .set('Cookie', auth.cookieHeader).set('X-CSRF-Token', auth.csrfHeader);
    expect(list.body.tags).toHaveLength(1);
  });

  it('POST deduplica tag case-insensitive', async () => {
    const { auth } = await setupBroadcaster();

    await request(app).post('/api/broadcaster-proposals/payment-tags')
      .set('Cookie', auth.cookieHeader).set('X-CSRF-Token', auth.csrfHeader)
      .send({ label: 'Vencimento' });

    const dup = await request(app).post('/api/broadcaster-proposals/payment-tags')
      .set('Cookie', auth.cookieHeader).set('X-CSRF-Token', auth.csrfHeader)
      .send({ label: 'vencimento' });

    expect(dup.status).toBe(200);
    const count = await BroadcasterPaymentTag.countDocuments();
    expect(count).toBe(1);
  });

  it('POST rejeita label vazio com 400', async () => {
    const { auth } = await setupBroadcaster();
    const res = await request(app).post('/api/broadcaster-proposals/payment-tags')
      .set('Cookie', auth.cookieHeader).set('X-CSRF-Token', auth.csrfHeader)
      .send({ label: '   ' });
    expect(res.status).toBe(400);
  });

  it('DELETE remove tag', async () => {
    const { auth } = await setupBroadcaster();

    const create = await request(app).post('/api/broadcaster-proposals/payment-tags')
      .set('Cookie', auth.cookieHeader).set('X-CSRF-Token', auth.csrfHeader)
      .send({ label: 'Temp' });
    const id = create.body.tag._id;

    const del = await request(app).delete(`/api/broadcaster-proposals/payment-tags/${id}`)
      .set('Cookie', auth.cookieHeader).set('X-CSRF-Token', auth.csrfHeader);
    expect(del.status).toBe(200);

    const list = await request(app).get('/api/broadcaster-proposals/payment-tags')
      .set('Cookie', auth.cookieHeader).set('X-CSRF-Token', auth.csrfHeader);
    expect(list.body.tags).toHaveLength(0);
  });

  it('DELETE retorna 404 para id inexistente', async () => {
    const { auth } = await setupBroadcaster();
    const fakeId = '6123456789abcdef01234567';
    const res = await request(app).delete(`/api/broadcaster-proposals/payment-tags/${fakeId}`)
      .set('Cookie', auth.cookieHeader).set('X-CSRF-Token', auth.csrfHeader);
    expect(res.status).toBe(404);
  });

  it('GET retorna 401 sem auth', async () => {
    const res = await request(app).get('/api/broadcaster-proposals/payment-tags');
    expect(res.status).toBe(401);
  });

  it('GET retorna 403 quando nao eh broadcaster', async () => {
    const { auth } = await createAdvertiser();
    const res = await request(app).get('/api/broadcaster-proposals/payment-tags')
      .set('Cookie', auth.cookieHeader).set('X-CSRF-Token', auth.csrfHeader);
    expect(res.status).toBe(403);
  });

  it('tags sao isoladas por emissora', async () => {
    const { auth: auth1 } = await setupBroadcaster();
    const { auth: auth2 } = await setupBroadcaster();

    await request(app).post('/api/broadcaster-proposals/payment-tags')
      .set('Cookie', auth1.cookieHeader).set('X-CSRF-Token', auth1.csrfHeader)
      .send({ label: 'Apenas-B1' });

    const list2 = await request(app).get('/api/broadcaster-proposals/payment-tags')
      .set('Cookie', auth2.cookieHeader).set('X-CSRF-Token', auth2.csrfHeader);
    expect(list2.body.tags).toHaveLength(0);
  });
});
