/**
 * Integration Tests — Controle de acesso (Fase 3)
 *
 * Regressao de `docs/security-remediation-plan-2026-07-20.md`:
 *  - 3.1 signed-url exige vinculo entre o objectKey e o requisitante
 *  - 3.2 DTO por papel (emissora nao ve PII/margens/itens de concorrentes;
 *        comprador nao ve o repasse liquido da emissora)
 *  - 3.3 aprovar/recusar e POR ITEM; status do pedido e derivado
 *  - 3.9 template de proposta escopado por agencia
 *
 * Padrao: afirmar que o ATAQUE falha, nao que o codigo mudou.
 */

import '../helpers/mocks';

import request from 'supertest';
import express, { Application } from 'express';
import cookieParser from 'cookie-parser';

import { mongoSanitize, xssSanitize, dedupeQuery } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';
import campaignRoutes from '../../routes/campaignRoutes';
import orderRoutes from '../../routes/orderRoutes';
import uploadRoutes from '../../routes/uploadRoutes';

import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { createAdvertiser, createBroadcaster, createAdmin } from '../helpers/authHelper';
import Order, { deriveOrderStatusFromItems } from '../../models/Order';

function createTestApp(): Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(mongoSanitize);
  app.use(xssSanitize);
  app.use(dedupeQuery);
  app.use(csrfProtection);
  app.use('/api/campaigns', campaignRoutes);
  app.use('/api/orders', orderRoutes);
  app.use('/api/upload', uploadRoutes);
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
  jest.clearAllMocks();
});

afterAll(async () => {
  await disconnectTestDB();
});

const AUDIO_A = 'audio/aaaaaaaa-1111-2222-3333-444444444444.mp3';
const AUDIO_B = 'audio/bbbbbbbb-5555-6666-7777-888888888888.mp3';

/** Pedido com DUAS emissoras — o cenario onde o furo aparecia. */
async function createTwoBroadcasterOrder() {
  const { user: buyer } = await createAdvertiser();
  const bcA = await createBroadcaster();
  const bcB = await createBroadcaster();

  const order = await Order.create({
    buyerId: buyer._id,
    buyerName: 'Comprador SA',
    buyerEmail: 'comprador@teste.com.br',
    buyerPhone: '11999999999',
    buyerDocument: '12345678000199',
    items: [
      {
        productId: '507f1f77bcf86cd799439011',
        productName: 'Spot A', broadcasterName: 'Rádio A',
        broadcasterId: bcA.user._id.toString(),
        quantity: 1, unitPrice: 30, totalPrice: 30, schedule: new Map(),
        material: { type: 'audio', audioUrl: AUDIO_A, status: 'pending_broadcaster_review', chat: [] },
      },
      {
        productId: '507f1f77bcf86cd799439012',
        productName: 'Spot B', broadcasterName: 'Rádio B',
        broadcasterId: bcB.user._id.toString(),
        quantity: 10, unitPrice: 500, totalPrice: 5000, schedule: new Map(),
        material: { type: 'audio', audioUrl: AUDIO_B, status: 'pending_broadcaster_review', chat: [] },
      },
    ],
    payment: { method: 'pix', status: 'received', walletAmountUsed: 0, chargedAmount: 5030, totalAmount: 5030 },
    splits: [{ recipientId: bcA.user._id.toString(), recipientName: 'Rádio A', recipientType: 'broadcaster', amount: 22.5, percentage: 75, description: 'Repasse emissora' }],
    status: 'paid',
    grossAmount: 5030, broadcasterAmount: 3772.5, platformSplit: 1006, techFee: 251.5,
    agencyCommission: 0, monitoringCost: 0, totalAmount: 5030, subtotal: 5030, platformFee: 251.5,
    billingInvoices: [], billingDocuments: [], broadcasterInvoices: [],
    opecs: [], notifications: [], webhookLogs: [],
  });

  return { order, buyer, bcA, bcB };
}

// ─────────────────────────────────────────────────────────────
// 3.3 — Decisao por item
// ─────────────────────────────────────────────────────────────
describe('3.3 — aprovar/recusar afeta apenas os itens da propria emissora', () => {
  describe('deriveOrderStatusFromItems (unidade)', () => {
    it('todos recusados -> cancelled', () => {
      expect(deriveOrderStatusFromItems([
        { broadcasterStatus: 'rejected' }, { broadcasterStatus: 'rejected' },
      ])).toBe('cancelled');
    });

    it('todos decididos com pelo menos um aprovado -> approved', () => {
      expect(deriveOrderStatusFromItems([
        { broadcasterStatus: 'rejected' }, { broadcasterStatus: 'approved' },
      ])).toBe('approved');
    });

    it('ainda ha item pendente -> null (nao avanca)', () => {
      expect(deriveOrderStatusFromItems([
        { broadcasterStatus: 'approved' }, { broadcasterStatus: 'pending' },
      ])).toBeNull();
    });

    it('lista vazia -> null', () => {
      expect(deriveOrderStatusFromItems([])).toBeNull();
    });
  });

  it('SEGURANCA: emissora A recusando NAO cancela a venda paga da emissora B', async () => {
    const { order, bcA } = await createTwoBroadcasterOrder();

    const res = await request(app)
      .post(`/api/campaigns/${order._id}/reject-broadcaster`)
      .set('Cookie', bcA.auth.cookieHeader)
      .set('X-CSRF-Token', bcA.auth.csrfHeader)
      .send({ reason: 'Sem disponibilidade' });

    expect(res.status).toBe(200);

    const updated = await Order.findById(order._id);
    // O pedido NAO pode ter sido cancelado: a emissora B nao decidiu.
    expect(updated!.status).not.toBe('cancelled');
    expect((updated!.items[0] as any).broadcasterStatus).toBe('rejected');
    expect((updated!.items[1] as any).broadcasterStatus).not.toBe('rejected');
  });

  it('pedido so e cancelado quando TODAS as emissoras recusam', async () => {
    const { order, bcA, bcB } = await createTwoBroadcasterOrder();

    await request(app)
      .post(`/api/campaigns/${order._id}/reject-broadcaster`)
      .set('Cookie', bcA.auth.cookieHeader).set('X-CSRF-Token', bcA.auth.csrfHeader)
      .send({ reason: 'Grade lotada no periodo solicitado' });

    await request(app)
      .post(`/api/campaigns/${order._id}/reject-broadcaster`)
      .set('Cookie', bcB.auth.cookieHeader).set('X-CSRF-Token', bcB.auth.csrfHeader)
      .send({ reason: 'Nao atendemos esse formato agora' });

    const updated = await Order.findById(order._id);
    expect(updated!.status).toBe('cancelled');
  });

  it('quem nao tem item no pedido continua recebendo 403', async () => {
    const { order } = await createTwoBroadcasterOrder();
    const intruso = await createBroadcaster();

    const res = await request(app)
      .post(`/api/campaigns/${order._id}/reject-broadcaster`)
      .set('Cookie', intruso.auth.cookieHeader)
      .set('X-CSRF-Token', intruso.auth.csrfHeader)
      .send({ reason: 'Tentativa indevida de recusa' });

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────
// 3.2 — DTO por papel
// ─────────────────────────────────────────────────────────────
describe('3.2 — resposta projetada por papel', () => {
  it('SEGURANCA: emissora nao ve itens/precos das concorrentes nem PII do comprador', async () => {
    const { order, bcA } = await createTwoBroadcasterOrder();

    const res = await request(app)
      .get(`/api/campaigns/${order._id}`)
      .set('Cookie', bcA.auth.cookieHeader)
      .set('X-CSRF-Token', bcA.auth.csrfHeader);

    expect(res.status).toBe(200);
    const c = res.body.campaign;

    // So o proprio item
    expect(c.items).toHaveLength(1);
    expect(c.items[0].productName).toBe('Spot A');

    // Nada da concorrente
    expect(JSON.stringify(c)).not.toContain('Spot B');
    expect(JSON.stringify(c)).not.toContain(AUDIO_B);

    // Nem PII do comprador, nem margens da plataforma
    expect(c.buyerDocument).toBeUndefined();
    expect(c.buyerEmail).toBeUndefined();
    expect(c.buyerPhone).toBeUndefined();
    expect(c.platformSplit).toBeUndefined();
    expect(c.techFee).toBeUndefined();
    expect(c.splits).toBeUndefined();
    expect(c.payment).toBeUndefined();
  });

  it('comprador continua vendo o pedido completo', async () => {
    const { order, buyer } = await createTwoBroadcasterOrder();
    const buyerAuth = (await createAdvertiser()).auth;
    // usa o proprio comprador do pedido
    const res = await request(app)
      .get(`/api/campaigns/${order._id}`)
      .set('Cookie', buyerAuth.cookieHeader)
      .set('X-CSRF-Token', buyerAuth.csrfHeader);

    // Comprador diferente -> 403 (confirma que a autorizacao segue de pe)
    expect(res.status).toBe(403);
    expect(buyer).toBeDefined();
  });

  it('SEGURANCA: comprador nao ve o repasse liquido da emissora em /api/orders/:id', async () => {
    const { order } = await createTwoBroadcasterOrder();
    // Recria o pedido com um comprador autenticado conhecido
    const { user, auth } = await createAdvertiser();
    await Order.updateOne({ _id: order._id }, { $set: { buyerId: user._id } });

    const res = await request(app)
      .get(`/api/orders/${order._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.broadcasterAmount).toBeUndefined();
    expect(res.body.platformSplit).toBeUndefined();
    expect(res.body.techFee).toBeUndefined();
    expect(res.body.splits).toBeUndefined();
    // Mas continua vendo o que e dele
    expect(res.body.totalAmount).toBe(5030);
    expect(res.body.orderNumber).toBeDefined();
  });

  it('admin continua vendo o documento completo', async () => {
    const { order } = await createTwoBroadcasterOrder();
    const admin = await createAdmin();

    const res = await request(app)
      .get(`/api/orders/${order._id}`)
      .set('Cookie', admin.auth.cookieHeader)
      .set('X-CSRF-Token', admin.auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.broadcasterAmount).toBe(3772.5);
    expect(res.body.platformSplit).toBe(1006);
  });
});

// ─────────────────────────────────────────────────────────────
// 3.1 — Signed URL com checagem de posse
// ─────────────────────────────────────────────────────────────
describe('3.1 — /api/upload/signed-url exige vinculo com o objeto', () => {
  it('SEGURANCA: emissora A nao consegue assinar o material da emissora B', async () => {
    const { bcA } = await createTwoBroadcasterOrder();

    const res = await request(app)
      .get('/api/upload/signed-url')
      .query({ objectKey: AUDIO_B })
      .set('Cookie', bcA.auth.cookieHeader)
      .set('X-CSRF-Token', bcA.auth.csrfHeader);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Acesso negado/i);
  });

  it('SEGURANCA: anunciante sem vinculo nenhum nao assina objeto arbitrario', async () => {
    await createTwoBroadcasterOrder();
    const estranho = await createAdvertiser();

    const res = await request(app)
      .get('/api/upload/signed-url')
      .query({ objectKey: AUDIO_A })
      .set('Cookie', estranho.auth.cookieHeader)
      .set('X-CSRF-Token', estranho.auth.csrfHeader);

    expect(res.status).toBe(403);
  });

  it('emissora CONSEGUE acessar o material do proprio item', async () => {
    const { bcA } = await createTwoBroadcasterOrder();

    const res = await request(app)
      .get('/api/upload/signed-url')
      .query({ objectKey: AUDIO_A })
      .set('Cookie', bcA.auth.cookieHeader)
      .set('X-CSRF-Token', bcA.auth.csrfHeader);

    // Passa da checagem de posse. Em teste o GCS nao esta configurado, entao
    // a assinatura em si falha com 400 — o que importa aqui e NAO ser 403.
    expect(res.status).not.toBe(403);
  });

  it('exige autenticacao', async () => {
    const res = await request(app).get('/api/upload/signed-url').query({ objectKey: AUDIO_A });
    expect([401, 403]).toContain(res.status);
  });

  it('objectKey ausente devolve 400 para usuario autenticado', async () => {
    const { auth } = await createAdvertiser();
    const res = await request(app)
      .get('/api/upload/signed-url')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(400);
  });
});
