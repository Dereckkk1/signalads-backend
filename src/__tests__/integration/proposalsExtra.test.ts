/**
 * Integration Tests — Proposals API (branches extras)
 * Foco: createProposal branches (commission, monitoring, custom items, discount),
 *       getProposals (search/status filters), updateProposal (discount, commission),
 *       trackViewSession, respondToProposal edge cases.
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
import proposalRoutes from '../../routes/proposalRoutes';

import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { createAgency, createBroadcaster } from '../helpers/authHelper';
import { Product } from '../../models/Product';
import Proposal from '../../models/Proposal';

function createProposalTestApp(): Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(mongoSanitize);
  app.use(xssSanitize);
  app.use(hpp());
  app.use(csrfProtection);
  app.use('/api/proposals', proposalRoutes);
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
  app = createProposalTestApp();
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

function buildCustomItem(name = 'Producao', price = 500) {
  return {
    isCustom: true,
    productName: name,
    quantity: 1,
    unitPrice: price,
    totalPrice: price,
    broadcasterId: new mongoose.Types.ObjectId().toString(),
    broadcasterName: 'Radio',
  };
}

// ═══════════════════════════════════════════════════════════════
// POST /api/proposals — branches de criação
// ═══════════════════════════════════════════════════════════════
describe('POST /api/proposals — branches de criacao', () => {
  it('cria proposta com item customizado (isCustom=true)', async () => {
    const { auth } = await createAgency();

    const res = await request(app)
      .post('/api/proposals')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        title: 'Proposta com Custom',
        items: [buildCustomItem('Locução', 800)],
      });

    expect(res.status).toBe(201);
    expect(res.body.proposal.items[0].isCustom).toBe(true);
    expect(res.body.proposal.grossAmount).toBeGreaterThan(0);
  });

  it('retorna 400 para item customizado com preco zero', async () => {
    const { auth } = await createAgency();

    const res = await request(app)
      .post('/api/proposals')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        title: 'Preco Invalido',
        items: [{ isCustom: true, productName: 'Teste', quantity: 1, unitPrice: 0, totalPrice: 0 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/R\$ 0/i);
  });

  it('cria proposta com agencyCommission calculada', async () => {
    const { auth } = await createAgency();

    const res = await request(app)
      .post('/api/proposals')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        title: 'Com Comissao',
        agencyCommission: 15,
        items: [buildCustomItem('Item', 1000)],
      });

    expect(res.status).toBe(201);
    expect(res.body.proposal.agencyCommission).toBe(15);
    expect(res.body.proposal.agencyCommissionAmount).toBeGreaterThan(0);
  });

  it('cria proposta com monitoring habilitado', async () => {
    const { auth } = await createAgency();
    const { product } = await createBroadcasterWithProduct();

    const res = await request(app)
      .post('/api/proposals')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        title: 'Com Monitoramento',
        isMonitoringEnabled: true,
        items: [{
          productId: product._id.toString(),
          productName: 'Comercial 30s',
          quantity: 5,
          unitPrice: 125,
          totalPrice: 625,
          broadcasterId: product.broadcasterId.toString(),
          broadcasterName: 'Radio',
        }],
      });

    expect(res.status).toBe(201);
    // monitoringCost deve ser > 0 quando monitoring habilitado (R$70 por emissora)
    expect(res.body.proposal.monitoringCost).toBeGreaterThan(0);
  });

  it('cria proposta com desconto global aplicado', async () => {
    const { auth } = await createAgency();

    const res = await request(app)
      .post('/api/proposals')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        title: 'Com Desconto',
        discount: { type: 'percentage', value: 10 },
        items: [buildCustomItem('Item', 2000)],
      });

    expect(res.status).toBe(201);
    expect(res.body.proposal.discountAmount).toBeGreaterThan(0);
  });

  it('retorna 400 para produto inexistente na proposta', async () => {
    const { auth } = await createAgency();

    const res = await request(app)
      .post('/api/proposals')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        title: 'Produto Inexistente',
        items: [{
          productId: new mongoose.Types.ObjectId().toString(),
          productName: 'Nao existe',
          quantity: 1,
          unitPrice: 100,
          totalPrice: 100,
          broadcasterId: new mongoose.Types.ObjectId().toString(),
          broadcasterName: 'Radio',
        }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/não encontrado/i);
  });

  it('retorna 400 para preco ajustado abaixo de 50% do original', async () => {
    const { auth } = await createAgency();
    const { product } = await createBroadcasterWithProduct();

    const res = await request(app)
      .post('/api/proposals')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        title: 'Preco Ajustado Baixo',
        items: [{
          productId: product._id.toString(),
          productName: 'Comercial 30s',
          quantity: 1,
          unitPrice: 125,
          totalPrice: 125,
          adjustedPrice: 10, // menos de 50% de 125
          broadcasterId: product.broadcasterId.toString(),
          broadcasterName: 'Radio',
        }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/50%/i);
  });
});

// ═══════════════════════════════════════════════════════════════
// GET /api/proposals — filtros e paginacao
// ═══════════════════════════════════════════════════════════════
describe('GET /api/proposals — filtros e paginacao', () => {
  it('filtra por status', async () => {
    const { user: agency, auth } = await createAgency();

    await Proposal.create({
      agencyId: agency._id,
      title: 'Rascunho',
      slug: `slug-draft-${Date.now()}`,
      items: [],
      grossAmount: 0,
      totalAmount: 0,
      status: 'draft',
    });

    await Proposal.create({
      agencyId: agency._id,
      title: 'Enviada',
      slug: `slug-sent-${Date.now()}`,
      items: [],
      grossAmount: 0,
      totalAmount: 0,
      status: 'sent',
    });

    const res = await request(app)
      .get('/api/proposals?status=draft')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.proposals).toHaveLength(1);
    expect(res.body.proposals[0].status).toBe('draft');
  });

  it('filtra por busca (search)', async () => {
    const { user: agency, auth } = await createAgency();

    await Proposal.create({
      agencyId: agency._id,
      title: 'Campanha Radio FM',
      slug: `slug-radio-${Date.now()}`,
      items: [],
      grossAmount: 0,
      totalAmount: 0,
      status: 'draft',
    });

    await Proposal.create({
      agencyId: agency._id,
      title: 'Oferta TV',
      slug: `slug-tv-${Date.now()}`,
      items: [],
      grossAmount: 0,
      totalAmount: 0,
      status: 'draft',
    });

    const res = await request(app)
      .get('/api/proposals?search=Radio')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.proposals).toHaveLength(1);
    expect(res.body.proposals[0].title).toContain('Radio');
  });

  it('suporta paginacao com page e limit', async () => {
    const { user: agency, auth } = await createAgency();

    for (let i = 0; i < 5; i++) {
      await Proposal.create({
        agencyId: agency._id,
        title: `Proposta ${i}`,
        slug: `slug-pag-${i}-${Date.now()}`,
        items: [],
        grossAmount: 0,
        totalAmount: 0,
        status: 'draft',
      });
    }

    const res = await request(app)
      .get('/api/proposals?page=1&limit=2')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.proposals).toHaveLength(2);
    expect(res.body.pagination.total).toBe(5);
    expect(res.body.pagination.pages).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════
// PUT /api/proposals/:id — branches de update
// ═══════════════════════════════════════════════════════════════
describe('PUT /api/proposals/:id — branches de update', () => {
  async function createDraftProposal(agencyId: string, grossAmount = 1000) {
    return Proposal.create({
      agencyId,
      title: 'Proposta Draft',
      slug: `slug-update-${Date.now()}`,
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

  it('atualiza apenas agencyCommission sem alterar items', async () => {
    const { user: agency, auth } = await createAgency();
    const proposal = await createDraftProposal(agency._id.toString());

    const res = await request(app)
      .put(`/api/proposals/${proposal._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ agencyCommission: 12 });

    expect(res.status).toBe(200);
    expect(res.body.proposal.agencyCommission).toBe(12);
    expect(res.body.proposal.agencyCommissionAmount).toBeGreaterThan(0);
  });

  it('aplica desconto global ao atualizar proposta', async () => {
    const { user: agency, auth } = await createAgency();
    const proposal = await createDraftProposal(agency._id.toString(), 2000);

    const res = await request(app)
      .put(`/api/proposals/${proposal._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ discount: { type: 'percentage', value: 10, reason: 'Black Friday' } });

    expect(res.status).toBe(200);
    expect(res.body.proposal.discountAmount).toBeGreaterThan(0);
    expect(res.body.proposal.discount.type).toBe('percentage');
  });

  it('remove desconto ao passar discount nulo', async () => {
    const { user: agency, auth } = await createAgency();
    const proposal = await Proposal.create({
      agencyId: agency._id,
      title: 'Com Desconto',
      slug: `slug-nodiscount-${Date.now()}`,
      items: [],
      grossAmount: 1000,
      totalAmount: 1050,
      techFee: 50,
      discount: { type: 'percentage', value: 5 },
      discountAmount: 50,
      status: 'draft',
    });

    const res = await request(app)
      .put(`/api/proposals/${proposal._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ discount: { value: 0 } });

    expect(res.status).toBe(200);
    expect(res.body.proposal.discountAmount).toBe(0);
  });

  it('atualiza items com calculo de recording (custo de producao)', async () => {
    const { user: agency, auth } = await createAgency();
    const { product } = await createBroadcasterWithProduct();
    const proposal = await createDraftProposal(agency._id.toString());

    const res = await request(app)
      .put(`/api/proposals/${proposal._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        items: [{
          productId: product._id.toString(),
          productName: 'Comercial 30s',
          quantity: 3,
          unitPrice: 125,
          totalPrice: 375,
          broadcasterId: product.broadcasterId.toString(),
          broadcasterName: 'Radio',
          needsRecording: true,
        }],
      });

    expect(res.status).toBe(200);
    expect(res.body.proposal.productionCost).toBe(50); // 1 recording unica
  });

  it('atualiza titulo e clientName', async () => {
    const { user: agency, auth } = await createAgency();
    const proposal = await createDraftProposal(agency._id.toString());

    const res = await request(app)
      .put(`/api/proposals/${proposal._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ title: 'Titulo Novo', clientName: 'Cliente Novo' });

    expect(res.status).toBe(200);
    expect(res.body.proposal.title).toBe('Titulo Novo');
    expect(res.body.proposal.clientName).toBe('Cliente Novo');
  });
});

// ═══════════════════════════════════════════════════════════════
// POST /api/proposals/public/:slug/session — trackViewSession
// ═══════════════════════════════════════════════════════════════
describe('POST /api/proposals/public/:slug/session', () => {
  it('registra sessao de visualizacao na proposta', async () => {
    const slug = `session-test-${Date.now()}`;
    await Proposal.create({
      agencyId: new mongoose.Types.ObjectId(),
      title: 'Sessao Test',
      slug,
      items: [],
      grossAmount: 0,
      totalAmount: 0,
      status: 'sent',
    });

    const res = await request(app)
      .post(`/api/proposals/public/${slug}/session`)
      .send({ duration: 45, scrollDepth: 80 });

    expect(res.status).toBe(200);
  });

  it('ignora sessao com duration zero ou negativo (fire-and-forget)', async () => {
    // trackViewSession e fire-and-forget — sempre retorna 200 mesmo com dados invalidos
    const res = await request(app)
      .post('/api/proposals/public/slug-qualquer/session')
      .send({ duration: 0, scrollDepth: 50 });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// POST /api/proposals/public/:slug/respond — edge cases
// ═══════════════════════════════════════════════════════════════
describe('POST /api/proposals/public/:slug/respond — edge cases', () => {
  it('retorna 400 para proposta ja aprovada (nao pode responder duas vezes)', async () => {
    const slug = `respond-approved-${Date.now()}`;
    await Proposal.create({
      agencyId: new mongoose.Types.ObjectId(),
      title: 'Ja Aprovada',
      slug,
      items: [],
      grossAmount: 0,
      totalAmount: 0,
      status: 'approved', // ja respondida
    });

    const res = await request(app)
      .post(`/api/proposals/public/${slug}/respond`)
      .send({ action: 'approve', authorName: 'Cliente', authorEmail: 'c@c.com' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/já foi respondida/i);
  });

  it('retorna 400 para action invalida (nem approve nem reject)', async () => {
    const slug = `respond-invalid-${Date.now()}`;
    await Proposal.create({
      agencyId: new mongoose.Types.ObjectId(),
      title: 'Invalida',
      slug,
      items: [],
      grossAmount: 0,
      totalAmount: 0,
      status: 'sent',
    });

    const res = await request(app)
      .post(`/api/proposals/public/${slug}/respond`)
      .send({ action: 'maybe', authorName: 'Cliente', authorEmail: 'c@c.com' });

    expect(res.status).toBe(400);
  });

  it('retorna 410 para proposta expirada', async () => {
    const slug = `respond-expired-${Date.now()}`;
    await Proposal.create({
      agencyId: new mongoose.Types.ObjectId(),
      title: 'Expirada',
      slug,
      items: [],
      grossAmount: 0,
      totalAmount: 0,
      status: 'expired',
    });

    const res = await request(app)
      .post(`/api/proposals/public/${slug}/respond`)
      .send({ action: 'approve', authorName: 'Cliente', authorEmail: 'c@c.com' });

    expect(res.status).toBe(410);
  });
});

// ═══════════════════════════════════════════════════════════════
// PUT /api/proposals/:id/customization — error path
// ═══════════════════════════════════════════════════════════════
describe('PUT /api/proposals/:id/customization — paths', () => {
  it('retorna 400 quando customization esta ausente no body', async () => {
    const { user: agency, auth } = await createAgency();
    const proposal = await Proposal.create({
      agencyId: agency._id,
      title: 'Customizacao',
      slug: `custom-${Date.now()}`,
      items: [],
      grossAmount: 0,
      totalAmount: 0,
      status: 'draft',
    });

    const res = await request(app)
      .put(`/api/proposals/${proposal._id}/customization`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({});

    expect(res.status).toBe(400);
  });
});
