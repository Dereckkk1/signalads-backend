/**
 * Integration Tests — Broadcaster Proposals API (branches extras)
 * Cobre: createProposal branches (custom items, discount, commission),
 *        getProposals (search/filter), updateProposal branches,
 *        respondToProposal edge cases.
 */

import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';
import mongoose from 'mongoose';
import express from 'express';
import cookieParser from 'cookie-parser';
import hpp from 'hpp';

import { mongoSanitize, xssSanitize } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';
import broadcasterProposalRoutes from '../../routes/broadcasterProposalRoutes';

import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { createBroadcaster, createAdvertiser } from '../helpers/authHelper';
import { Product } from '../../models/Product';
import Proposal from '../../models/Proposal';

function createBroadcasterProposalApp(): Application {
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
  app = createBroadcasterProposalApp();
});

afterEach(async () => {
  await clearTestDB();
});

afterAll(async () => {
  await disconnectTestDB();
});

async function createBroadcasterWithProduct() {
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

function customItem(price = 500) {
  return {
    isCustom: true,
    productName: 'Locucao',
    quantity: 1,
    unitPrice: price,
    totalPrice: price,
  };
}

// ═══════════════════════════════════════════════════════════════
// POST /api/broadcaster-proposals — branches de criacao
// ═══════════════════════════════════════════════════════════════
describe('POST /api/broadcaster-proposals — branches de criacao', () => {
  it('cria proposta com item customizado', async () => {
    const { auth } = await createBroadcasterWithProduct();

    const res = await request(app)
      .post('/api/broadcaster-proposals')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        title: 'Proposta Custom',
        items: [customItem(800)],
      });

    expect(res.status).toBe(201);
    expect(res.body.proposal.items[0].isCustom).toBe(true);
  });

  it('cria proposta com item customizado de preco alto', async () => {
    const { auth } = await createBroadcasterWithProduct();

    const res = await request(app)
      .post('/api/broadcaster-proposals')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        title: 'Preco Alto',
        items: [{ isCustom: true, productName: 'Pacote Premium', quantity: 1, unitPrice: 5000, totalPrice: 5000 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.proposal.grossAmount).toBe(5000);
  });

  it('cria proposta com desconto global', async () => {
    const { auth } = await createBroadcasterWithProduct();

    const res = await request(app)
      .post('/api/broadcaster-proposals')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        title: 'Com Desconto',
        discount: { type: 'percentage', value: 10 },
        items: [customItem(2000)],
      });

    expect(res.status).toBe(201);
    expect(res.body.proposal.discountAmount).toBeGreaterThan(0);
  });

  it('retorna 400 para produto inexistente', async () => {
    const { auth } = await createBroadcasterWithProduct();

    const res = await request(app)
      .post('/api/broadcaster-proposals')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        title: 'Produto Invalido',
        items: [{
          productId: new mongoose.Types.ObjectId().toString(),
          productName: 'Nao existe',
          quantity: 1,
          unitPrice: 100,
          totalPrice: 100,
        }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/não encontrado/i);
  });

  it('retorna 403 para advertiser', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .post('/api/broadcaster-proposals')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ title: 'Test', items: [customItem()] });

    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════
// GET /api/broadcaster-proposals — filtros
// ═══════════════════════════════════════════════════════════════
describe('GET /api/broadcaster-proposals — filtros', () => {
  it('filtra por status', async () => {
    const { broadcaster, auth } = await createBroadcasterWithProduct();

    await Proposal.create({
      broadcasterId: broadcaster._id,
      ownerType: 'broadcaster',
      title: 'Rascunho',
      slug: `bp-draft-${Date.now()}`,
      items: [],
      grossAmount: 0,
      totalAmount: 0,
      status: 'draft',
    });

    await Proposal.create({
      broadcasterId: broadcaster._id,
      ownerType: 'broadcaster',
      title: 'Enviada',
      slug: `bp-sent-${Date.now()}`,
      items: [],
      grossAmount: 0,
      totalAmount: 0,
      status: 'sent',
    });

    const res = await request(app)
      .get('/api/broadcaster-proposals?status=sent')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.proposals).toHaveLength(1);
    expect(res.body.proposals[0].status).toBe('sent');
  });

  it('filtra por search', async () => {
    const { broadcaster, auth } = await createBroadcasterWithProduct();

    await Proposal.create({
      broadcasterId: broadcaster._id,
      ownerType: 'broadcaster',
      title: 'Campanha Especial',
      slug: `bp-search-${Date.now()}`,
      items: [],
      grossAmount: 0,
      totalAmount: 0,
      status: 'draft',
    });

    const res = await request(app)
      .get('/api/broadcaster-proposals?search=Especial')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.proposals).toHaveLength(1);
    expect(res.body.proposals[0].title).toContain('Especial');
  });

  it('suporta paginacao', async () => {
    const { broadcaster, auth } = await createBroadcasterWithProduct();

    for (let i = 0; i < 4; i++) {
      await Proposal.create({
        broadcasterId: broadcaster._id,
        ownerType: 'broadcaster',
        title: `Proposta ${i}`,
        slug: `bp-pag-${i}-${Date.now()}`,
        items: [],
        grossAmount: 0,
        totalAmount: 0,
        status: 'draft',
      });
    }

    const res = await request(app)
      .get('/api/broadcaster-proposals?page=1&limit=2')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.proposals).toHaveLength(2);
    expect(res.body.pagination.total).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════
// PUT /api/broadcaster-proposals/:id — branches
// ═══════════════════════════════════════════════════════════════
describe('PUT /api/broadcaster-proposals/:id — branches', () => {
  async function createDraft(broadcasterId: string, grossAmount = 1000) {
    return Proposal.create({
      broadcasterId,
      ownerType: 'broadcaster',
      title: 'Draft',
      slug: `bp-upd-${Date.now()}`,
      items: [{ productName: 'Spot', quantity: 5, unitPrice: 200, totalPrice: 1000, productType: 'Comercial 30s' }],
      grossAmount,
      totalAmount: grossAmount * 1.05,
      techFee: grossAmount * 0.05,
      agencyCommission: 0,
      agencyCommissionAmount: 0,
      monitoringCost: 0,
      status: 'draft',
    });
  }

  it('atualiza titulo e clientName', async () => {
    const { broadcaster, auth } = await createBroadcasterWithProduct();
    const proposal = await createDraft(broadcaster._id.toString());

    const res = await request(app)
      .put(`/api/broadcaster-proposals/${proposal._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ title: 'Novo Titulo', clientName: 'Cliente X' });

    expect(res.status).toBe(200);
    expect(res.body.proposal.title).toBe('Novo Titulo');
    expect(res.body.proposal.clientName).toBe('Cliente X');
  });

  it('aplica desconto global', async () => {
    const { broadcaster, auth } = await createBroadcasterWithProduct();
    const proposal = await createDraft(broadcaster._id.toString(), 2000);

    const res = await request(app)
      .put(`/api/broadcaster-proposals/${proposal._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ discount: { type: 'percentage', value: 15, reason: 'Desconto especial' } });

    expect(res.status).toBe(200);
    expect(res.body.proposal.discountAmount).toBeGreaterThan(0);
  });

  it('remove desconto ao zerar valor', async () => {
    const { broadcaster, auth } = await createBroadcasterWithProduct();
    const proposal = await Proposal.create({
      broadcasterId: broadcaster._id,
      ownerType: 'broadcaster',
      title: 'Com Desconto',
      slug: `bp-nodiscount-${Date.now()}`,
      items: [],
      grossAmount: 1000,
      totalAmount: 1050,
      techFee: 50,
      discount: { type: 'percentage', value: 5 },
      discountAmount: 50,
      status: 'draft',
    });

    const res = await request(app)
      .put(`/api/broadcaster-proposals/${proposal._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ discount: { value: 0 } });

    expect(res.status).toBe(200);
    expect(res.body.proposal.discountAmount).toBe(0);
  });

  it('retorna 404 para proposta de outra emissora', async () => {
    const { auth } = await createBroadcasterWithProduct();
    const { broadcaster: outra } = await createBroadcasterWithProduct();
    const proposal = await createDraft(outra._id.toString());

    const res = await request(app)
      .put(`/api/broadcaster-proposals/${proposal._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ title: 'Nao pode' });

    expect(res.status).toBe(404);
  });

  it('atualiza items e recalcula grossAmount', async () => {
    const { broadcaster, auth, product } = await createBroadcasterWithProduct();
    const proposal = await createDraft(broadcaster._id.toString());

    const res = await request(app)
      .put(`/api/broadcaster-proposals/${proposal._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        items: [{
          productId: product._id.toString(),
          productName: 'Comercial 30s',
          quantity: 2,
          unitPrice: 125,
          totalPrice: 250,
          broadcasterId: broadcaster._id.toString(),
          broadcasterName: 'Radio',
        }],
      });

    expect(res.status).toBe(200);
    expect(res.body.proposal.grossAmount).toBeGreaterThan(0);
    expect(res.body.proposal.items).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// DELETE /api/broadcaster-proposals/:id — branches
// ═══════════════════════════════════════════════════════════════
describe('DELETE /api/broadcaster-proposals/:id — branches', () => {
  it('retorna 404 para proposta de outra emissora', async () => {
    const { auth } = await createBroadcasterWithProduct();
    const { broadcaster: outra } = await createBroadcasterWithProduct();

    const proposal = await Proposal.create({
      broadcasterId: outra._id,
      ownerType: 'broadcaster',
      title: 'Alheia',
      slug: `bp-del-other-${Date.now()}`,
      items: [],
      grossAmount: 0,
      totalAmount: 0,
      status: 'draft',
    });

    const res = await request(app)
      .delete(`/api/broadcaster-proposals/${proposal._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════
// POST /api/broadcaster-proposals/:id/send — branches
// ═══════════════════════════════════════════════════════════════
describe('POST /api/broadcaster-proposals/:id/send — branches', () => {
  it('retorna 400 ao tentar enviar proposta aprovada (status nao permite)', async () => {
    const { broadcaster, auth } = await createBroadcasterWithProduct();

    const proposal = await Proposal.create({
      broadcasterId: broadcaster._id,
      ownerType: 'broadcaster',
      title: 'Ja Aprovada',
      slug: `bp-send-approved-${Date.now()}`,
      items: [{ productName: 'Spot', quantity: 1, unitPrice: 125, totalPrice: 125, productType: 'Comercial 30s' }],
      grossAmount: 125,
      totalAmount: 131.25,
      status: 'approved', // aprovada - nao pode enviar
    });

    const res = await request(app)
      .post(`/api/broadcaster-proposals/${proposal._id}/send`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/rascunho/i);
  });
});

// ═══════════════════════════════════════════════════════════════
// GET /api/broadcaster-proposals/:id — branches
// ═══════════════════════════════════════════════════════════════
describe('GET /api/broadcaster-proposals/:id — branches', () => {
  it('retorna 404 para proposta de outra emissora', async () => {
    const { auth } = await createBroadcasterWithProduct();
    const { broadcaster: outra } = await createBroadcasterWithProduct();

    const proposal = await Proposal.create({
      broadcasterId: outra._id,
      ownerType: 'broadcaster',
      title: 'Alheia',
      slug: `bp-get-other-${Date.now()}`,
      items: [],
      grossAmount: 0,
      totalAmount: 0,
      status: 'draft',
    });

    const res = await request(app)
      .get(`/api/broadcaster-proposals/${proposal._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(404);
  });
});
