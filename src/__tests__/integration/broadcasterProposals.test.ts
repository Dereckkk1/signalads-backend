/**
 * Integration Tests — Broadcaster Proposals API
 *
 * Tests real HTTP endpoints end-to-end.
 * POST   /api/broadcaster-proposals
 * GET    /api/broadcaster-proposals
 * GET    /api/broadcaster-proposals/:id
 * PUT    /api/broadcaster-proposals/:id
 * DELETE /api/broadcaster-proposals/:id
 * POST   /api/broadcaster-proposals/:id/duplicate
 * POST   /api/broadcaster-proposals/:id/send
 * GET    /api/broadcaster-proposals/my-products
 * GET    /api/broadcaster-proposals/templates
 * POST   /api/broadcaster-proposals/templates
 */

import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';
import mongoose from 'mongoose';
import express from 'express';
import cookieParser from 'cookie-parser';

import { mongoSanitize, xssSanitize, dedupeQuery } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';
import broadcasterProposalRoutes from '../../routes/broadcasterProposalRoutes';

import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import {
  createBroadcaster,
  createAdvertiser,
  createAgency,
} from '../helpers/authHelper';
import { Product } from '../../models/Product';
import Proposal from '../../models/Proposal';
import ProposalTemplate from '../../models/ProposalTemplate';
import ProposalVersion from '../../models/ProposalVersion';

function createBroadcasterProposalTestApp(): Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(mongoSanitize);
  app.use(xssSanitize);
  app.use(dedupeQuery);
  app.use(csrfProtection);
  app.use('/api/broadcaster-proposals', broadcasterProposalRoutes);
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
  app = createBroadcasterProposalTestApp();
});

afterEach(async () => {
  await clearTestDB();
});

afterAll(async () => {
  await disconnectTestDB();
});

/**
 * Helper: creates a broadcaster with products.
 */
async function createBroadcasterWithProducts() {
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
// POST /api/broadcaster-proposals
// ─────────────────────────────────────────────────
describe('POST /api/broadcaster-proposals', () => {
  it('should allow broadcaster to create a proposal with own products', async () => {
    const { broadcaster, auth, product } = await createBroadcasterWithProducts();

    const res = await request(app)
      .post('/api/broadcaster-proposals')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        title: 'Proposta Emissora',
        clientName: 'Cliente Teste',
        items: [
          {
            productId: product._id.toString(),
            broadcasterId: broadcaster._id.toString(),
            quantity: 10,
          },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.proposal).toBeDefined();
    expect(res.body.proposal.title).toBe('Proposta Emissora');
    expect(res.body.proposal.ownerType).toBe('broadcaster');
    expect(res.body.proposal.status).toBe('draft');
    expect(res.body.proposal.items).toHaveLength(1);
    // grossAmount = 100 * 10 = 1000 (netPrice — emissora vende direto, sem markup da plataforma)
    expect(res.body.proposal.grossAmount).toBe(1000);
  });

  it('should reject when items are missing', async () => {
    const { auth } = await createBroadcasterWithProducts();

    const res = await request(app)
      .post('/api/broadcaster-proposals')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ title: 'Proposta Vazia' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/obrigatórios/i);
  });

  it('should reject when non-broadcaster tries to create', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .post('/api/broadcaster-proposals')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        title: 'Proposta',
        items: [{ productId: 'fake', quantity: 1 }],
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/emissoras/i);
  });

  it('should reject when product does not belong to broadcaster', async () => {
    const { auth } = await createBroadcasterWithProducts();
    const { user: otherBroadcaster } = await createBroadcaster();

    const otherProduct = await Product.create({
      broadcasterId: otherBroadcaster._id,
      spotType: 'Comercial 15s',
      duration: 15,
      timeSlot: 'Rotativo',
      netPrice: 50,
      pricePerInsertion: 62.5,
      isActive: true,
    });

    const res = await request(app)
      .post('/api/broadcaster-proposals')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        title: 'Proposta Produto Alheio',
        items: [{ productId: otherProduct._id.toString(), quantity: 5 }],
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/não pertence/i);
  });

  it('should return 401 when unauthenticated', async () => {
    const res = await request(app)
      .post('/api/broadcaster-proposals')
      .send({ title: 'Sem Auth', items: [{ productId: 'fake', quantity: 1 }] });

    expect(res.status).toBe(401);
  });

  it('should support custom items', async () => {
    const { auth } = await createBroadcasterWithProducts();

    const res = await request(app)
      .post('/api/broadcaster-proposals')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        title: 'Proposta Custom',
        items: [
          {
            isCustom: true,
            productName: 'Patrocinio Especial',
            unitPrice: 800,
            quantity: 1,
          },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.proposal.items[0].isCustom).toBe(true);
    expect(res.body.proposal.grossAmount).toBe(800);
  });
});

// ─────────────────────────────────────────────────
// GET /api/broadcaster-proposals
// ─────────────────────────────────────────────────
describe('GET /api/broadcaster-proposals', () => {
  it('should list proposals for the authenticated broadcaster', async () => {
    const { broadcaster, auth } = await createBroadcasterWithProducts();

    await Proposal.create({
      ownerType: 'broadcaster',
      broadcasterId: broadcaster._id,
      title: 'Proposta Listada',
      slug: `b-list-${Date.now()}`,
      items: [{ productName: 'Comercial 30s', quantity: 5, unitPrice: 125, totalPrice: 625, productType: 'Comercial 30s' }],
      grossAmount: 625,
      totalAmount: 625,
      status: 'draft',
    });

    const res = await request(app)
      .get('/api/broadcaster-proposals')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.proposals).toHaveLength(1);
    expect(res.body.pagination).toBeDefined();
  });

  it('should not list proposals from other broadcasters', async () => {
    const { user: b1 } = await createBroadcaster();
    const { auth: auth2 } = await createBroadcaster();

    await Proposal.create({
      ownerType: 'broadcaster',
      broadcasterId: b1._id,
      title: 'Proposta Alheia',
      slug: `b-other-${Date.now()}`,
      items: [{ productName: 'Comercial 30s', quantity: 1, unitPrice: 100, totalPrice: 100, productType: 'Comercial 30s' }],
      grossAmount: 100,
      totalAmount: 100,
      status: 'draft',
    });

    const res = await request(app)
      .get('/api/broadcaster-proposals')
      .set('Cookie', auth2.cookieHeader)
      .set('X-CSRF-Token', auth2.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.proposals).toHaveLength(0);
  });

  it('should reject non-broadcaster users', async () => {
    const { auth } = await createAgency();

    const res = await request(app)
      .get('/api/broadcaster-proposals')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────
// GET /api/broadcaster-proposals/:id
// ─────────────────────────────────────────────────
describe('GET /api/broadcaster-proposals/:id', () => {
  it('should return proposal details for the owner broadcaster', async () => {
    const { broadcaster, auth } = await createBroadcasterWithProducts();

    const proposal = await Proposal.create({
      ownerType: 'broadcaster',
      broadcasterId: broadcaster._id,
      title: 'Detalhe Emissora',
      slug: `b-detail-${Date.now()}`,
      items: [{ productName: 'Comercial 30s', quantity: 3, unitPrice: 125, totalPrice: 375, productType: 'Comercial 30s' }],
      grossAmount: 375,
      totalAmount: 375,
      status: 'draft',
    });

    const res = await request(app)
      .get(`/api/broadcaster-proposals/${proposal._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.proposal.title).toBe('Detalhe Emissora');
  });

  it('should return 404 for non-existent proposal', async () => {
    const { auth } = await createBroadcasterWithProducts();
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .get(`/api/broadcaster-proposals/${fakeId}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────
// PUT /api/broadcaster-proposals/:id
// ─────────────────────────────────────────────────
describe('PUT /api/broadcaster-proposals/:id', () => {
  it('should update proposal title', async () => {
    const { broadcaster, auth } = await createBroadcasterWithProducts();

    const proposal = await Proposal.create({
      ownerType: 'broadcaster',
      broadcasterId: broadcaster._id,
      title: 'Titulo Antigo',
      slug: `b-update-${Date.now()}`,
      items: [{ productName: 'Comercial 30s', quantity: 5, unitPrice: 125, totalPrice: 625, productType: 'Comercial 30s' }],
      grossAmount: 625,
      totalAmount: 625,
      status: 'draft',
    });

    const res = await request(app)
      .put(`/api/broadcaster-proposals/${proposal._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ title: 'Titulo Novo' });

    expect(res.status).toBe(200);
    expect(res.body.proposal.title).toBe('Titulo Novo');
  });
});

// ─────────────────────────────────────────────────
// DELETE /api/broadcaster-proposals/:id
// ─────────────────────────────────────────────────
describe('DELETE /api/broadcaster-proposals/:id', () => {
  it('should delete proposal permanently', async () => {
    const { broadcaster, auth } = await createBroadcasterWithProducts();

    const proposal = await Proposal.create({
      ownerType: 'broadcaster',
      broadcasterId: broadcaster._id,
      title: 'Para Excluir',
      slug: `b-delete-${Date.now()}`,
      items: [{ productName: 'P', quantity: 1, unitPrice: 100, totalPrice: 100, productType: 'Comercial 30s' }],
      grossAmount: 100,
      totalAmount: 100,
      status: 'draft',
    });

    const res = await request(app)
      .delete(`/api/broadcaster-proposals/${proposal._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/sucesso/i);

    const deleted = await Proposal.findById(proposal._id);
    expect(deleted).toBeNull();
  });
});

// ─────────────────────────────────────────────────
// POST /api/broadcaster-proposals/:id/duplicate
// ─────────────────────────────────────────────────
describe('POST /api/broadcaster-proposals/:id/duplicate', () => {
  it('should duplicate a proposal as draft', async () => {
    const { broadcaster, auth } = await createBroadcasterWithProducts();

    const original = await Proposal.create({
      ownerType: 'broadcaster',
      broadcasterId: broadcaster._id,
      title: 'Original Emissora',
      slug: `b-orig-${Date.now()}`,
      items: [{ productName: 'Comercial 30s', quantity: 5, unitPrice: 125, totalPrice: 625, productType: 'Comercial 30s' }],
      grossAmount: 625,
      totalAmount: 625,
      status: 'sent',
    });

    const res = await request(app)
      .post(`/api/broadcaster-proposals/${original._id}/duplicate`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(201);
    expect(res.body.proposal.title).toMatch(/Cópia de/);
    expect(res.body.proposal.status).toBe('draft');
  });
});

// ─────────────────────────────────────────────────
// POST /api/broadcaster-proposals/:id/send
// ─────────────────────────────────────────────────
describe('POST /api/broadcaster-proposals/:id/send', () => {
  it('should mark proposal as sent', async () => {
    const { broadcaster, auth } = await createBroadcasterWithProducts();

    const proposal = await Proposal.create({
      ownerType: 'broadcaster',
      broadcasterId: broadcaster._id,
      title: 'Para Enviar',
      slug: `b-send-${Date.now()}`,
      items: [{ productName: 'P', quantity: 1, unitPrice: 100, totalPrice: 100, productType: 'Comercial 30s' }],
      grossAmount: 100,
      totalAmount: 100,
      status: 'draft',
    });

    const res = await request(app)
      .post(`/api/broadcaster-proposals/${proposal._id}/send`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.proposal.status).toBe('sent');
    expect(res.body.publicUrl).toBeDefined();
  });
});

// ─────────────────────────────────────────────────
// POST /api/broadcaster-proposals/:id/reopen
// Reabertura de proposta recusada para revisao (rejected -> returned)
// ─────────────────────────────────────────────────
describe('POST /api/broadcaster-proposals/:id/reopen', () => {
  async function createRejectedProposal(broadcasterId: mongoose.Types.ObjectId) {
    return Proposal.create({
      ownerType: 'broadcaster',
      broadcasterId,
      title: 'Proposta Recusada',
      slug: `b-reopen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      items: [{ productName: 'P', quantity: 1, unitPrice: 100, totalPrice: 100, productType: 'Comercial 30s' }],
      grossAmount: 100,
      totalAmount: 100,
      status: 'rejected',
      respondedAt: new Date(),
      responseNote: 'Muito caro',
      approval: { name: 'Cliente X' },
      statusHistory: [
        { status: 'sent', changedAt: new Date(Date.now() - 3600_000), actorType: 'broadcaster' },
        { status: 'rejected', changedAt: new Date(), note: 'Muito caro', actorType: 'client', actorName: 'Cliente X' },
      ],
    });
  }

  it('should move rejected proposal to returned and clear response fields', async () => {
    const { broadcaster, auth } = await createBroadcasterWithProducts();
    const proposal = await createRejectedProposal(broadcaster._id);

    const res = await request(app)
      .post(`/api/broadcaster-proposals/${proposal._id}/reopen`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ note: 'Vou ajustar os precos' });

    expect(res.status).toBe(200);
    expect(res.body.proposal.status).toBe('returned');

    // Persiste no banco
    const fresh = await Proposal.findById(proposal._id).lean();
    expect(fresh?.status).toBe('returned');
    // Nota da emissora registrada no statusHistory
    const returnedEntry = fresh?.statusHistory?.find((h: any) => h.status === 'returned');
    expect(returnedEntry).toBeDefined();
    expect(returnedEntry?.note).toBe('Vou ajustar os precos');
    expect(returnedEntry?.actorType).toBe('broadcaster');
    // Motivo da recusa continua disponivel em responseNote historico? Mantemos ate o reenvio — so sendProposal limpa.
    expect(fresh?.responseNote).toBe('Muito caro');
  });

  it('should accept reopen without a note', async () => {
    const { broadcaster, auth } = await createBroadcasterWithProducts();
    const proposal = await createRejectedProposal(broadcaster._id);

    const res = await request(app)
      .post(`/api/broadcaster-proposals/${proposal._id}/reopen`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.proposal.status).toBe('returned');
  });

  it('should return 401 when unauthenticated', async () => {
    const { broadcaster } = await createBroadcasterWithProducts();
    const proposal = await createRejectedProposal(broadcaster._id);

    const res = await request(app).post(`/api/broadcaster-proposals/${proposal._id}/reopen`).send({});

    expect(res.status).toBe(401);
  });

  it('should return 404 when proposal belongs to another broadcaster', async () => {
    const { auth } = await createBroadcasterWithProducts();
    const other = await createBroadcaster();
    const proposal = await createRejectedProposal(other.user._id);

    const res = await request(app)
      .post(`/api/broadcaster-proposals/${proposal._id}/reopen`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ note: 'tentativa' });

    expect(res.status).toBe(404);
  });

  it('should return 400 when proposal is not in rejected status', async () => {
    const { broadcaster, auth } = await createBroadcasterWithProducts();
    const proposal = await Proposal.create({
      ownerType: 'broadcaster',
      broadcasterId: broadcaster._id,
      title: 'Rascunho',
      slug: `b-draft-${Date.now()}`,
      items: [{ productName: 'P', quantity: 1, unitPrice: 100, totalPrice: 100, productType: 'Comercial 30s' }],
      grossAmount: 100,
      totalAmount: 100,
      status: 'draft',
    });

    const res = await request(app)
      .post(`/api/broadcaster-proposals/${proposal._id}/reopen`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({});

    expect(res.status).toBe(400);
  });

  it('should return 404 for nonexistent proposal', async () => {
    const { auth } = await createBroadcasterWithProducts();
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .post(`/api/broadcaster-proposals/${fakeId}/reopen`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({});

    expect(res.status).toBe(404);
  });

  it('should allow resending a returned proposal via POST /:id/send', async () => {
    const { broadcaster, auth } = await createBroadcasterWithProducts();
    const proposal = await Proposal.create({
      ownerType: 'broadcaster',
      broadcasterId: broadcaster._id,
      title: 'Em Revisao',
      slug: `b-resend-${Date.now()}`,
      items: [{ productName: 'P', quantity: 1, unitPrice: 100, totalPrice: 100, productType: 'Comercial 30s' }],
      grossAmount: 100,
      totalAmount: 100,
      status: 'returned',
      respondedAt: new Date(),
      responseNote: 'Motivo antigo',
      approval: { name: 'Cliente X', approvedAt: new Date() },
      statusHistory: [
        { status: 'sent', changedAt: new Date(Date.now() - 7200_000), actorType: 'broadcaster' },
        { status: 'rejected', changedAt: new Date(Date.now() - 3600_000), actorType: 'client' },
        { status: 'returned', changedAt: new Date(), actorType: 'broadcaster' },
      ],
    });

    const res = await request(app)
      .post(`/api/broadcaster-proposals/${proposal._id}/send`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.proposal.status).toBe('sent');

    // Resposta anterior foi limpa para permitir nova decisao
    const fresh = await Proposal.findById(proposal._id).lean();
    expect(fresh?.respondedAt).toBeFalsy();
    expect(fresh?.responseNote).toBeFalsy();
    // approval removido ou sem approvedAt
    expect((fresh as any)?.approval?.approvedAt).toBeFalsy();
    // statusHistory agora inclui novo 'sent' com nota de reenvio
    const sentEntries = fresh?.statusHistory?.filter((h: any) => h.status === 'sent') || [];
    expect(sentEntries.length).toBeGreaterThanOrEqual(2);
    expect(sentEntries[sentEntries.length - 1]?.note).toMatch(/revis/i);
  });
});

// ─────────────────────────────────────────────────
// GET /api/broadcaster-proposals/my-products
// ─────────────────────────────────────────────────
describe('GET /api/broadcaster-proposals/my-products', () => {
  it('should return products for the broadcaster', async () => {
    const { auth } = await createBroadcasterWithProducts();

    const res = await request(app)
      .get('/api/broadcaster-proposals/my-products')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.products).toBeDefined();
    expect(res.body.products.length).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────
// Templates
// ─────────────────────────────────────────────────
describe('Broadcaster Proposal Templates', () => {
  it('GET /api/broadcaster-proposals/templates should return templates', async () => {
    const { broadcaster, auth } = await createBroadcasterWithProducts();

    await ProposalTemplate.create({
      name: 'Template Emissora',
      broadcasterId: broadcaster._id,
      customization: {
        primaryColor: '#000000',
        secondaryColor: '#ffffff',
        backgroundColor: '#f0f0f0',
        textColor: '#333333',
        accentColor: '#0066cc',
        titleFont: 'Arial',
        bodyFont: 'Helvetica',
        sectionOrder: ['header', 'table'],
        hiddenSections: [],
        hiddenElements: [],
        kpis: [],
        metrics: [],
        customSections: [],
        customTexts: {},
      },
    });

    const res = await request(app)
      .get('/api/broadcaster-proposals/templates')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.templates.length).toBeGreaterThanOrEqual(1);
  });

  it('POST /api/broadcaster-proposals/templates should create a template', async () => {
    const { auth } = await createBroadcasterWithProducts();

    const res = await request(app)
      .post('/api/broadcaster-proposals/templates')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        name: 'Novo Template Emissora',
        customization: {
          primaryColor: '#112233',
          secondaryColor: '#445566',
          backgroundColor: '#ffffff',
          textColor: '#000000',
          accentColor: '#0099ff',
          titleFont: 'Space Grotesk',
          bodyFont: 'Fira Sans Condensed',
          sectionOrder: ['header', 'table', 'notes'],
          hiddenSections: [],
          hiddenElements: [],
          kpis: [],
          metrics: [],
          customSections: [],
          customTexts: {},
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.template.name).toBe('Novo Template Emissora');
  });

  it('PUT /api/broadcaster-proposals/templates/:id atualiza template', async () => {
    const { broadcaster, auth } = await createBroadcasterWithProducts();
    const template = await ProposalTemplate.create({
      name: 'Original',
      broadcasterId: broadcaster._id,
      customization: { primaryColor: '#000000', secondaryColor: '#ffffff', backgroundColor: '#f0f0f0', textColor: '#333333', accentColor: '#0066cc', titleFont: 'Arial', bodyFont: 'Helvetica', sectionOrder: [], hiddenSections: [], hiddenElements: [], kpis: [], metrics: [], customSections: [], customTexts: {} },
    });

    const res = await request(app)
      .put(`/api/broadcaster-proposals/templates/${template._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'Atualizado' });

    expect(res.status).toBe(200);
    expect(res.body.template.name).toBe('Atualizado');
  });

  it('DELETE /api/broadcaster-proposals/templates/:id deleta template', async () => {
    const { broadcaster, auth } = await createBroadcasterWithProducts();
    const template = await ProposalTemplate.create({
      name: 'Deletar',
      broadcasterId: broadcaster._id,
      customization: { primaryColor: '#000000', secondaryColor: '#ffffff', backgroundColor: '#f0f0f0', textColor: '#333333', accentColor: '#0066cc', titleFont: 'Arial', bodyFont: 'Helvetica', sectionOrder: [], hiddenSections: [], hiddenElements: [], kpis: [], metrics: [], customSections: [], customTexts: {} },
    });

    const res = await request(app)
      .delete(`/api/broadcaster-proposals/templates/${template._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/excluído/i);
    const still = await ProposalTemplate.findById(template._id);
    expect(still).toBeNull();
  });

  it('DELETE template retorna 404 para template de outra emissora', async () => {
    const { auth } = await createBroadcasterWithProducts();
    const { broadcaster: outra } = await createBroadcasterWithProducts();
    const template = await ProposalTemplate.create({
      name: 'Alheio',
      broadcasterId: outra._id,
      customization: { primaryColor: '#000000', secondaryColor: '#ffffff', backgroundColor: '#f0f0f0', textColor: '#333333', accentColor: '#0066cc', titleFont: 'Arial', bodyFont: 'Helvetica', sectionOrder: [], hiddenSections: [], hiddenElements: [], kpis: [], metrics: [], customSections: [], customTexts: {} },
    });

    const res = await request(app)
      .delete(`/api/broadcaster-proposals/templates/${template._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────
// GET /api/broadcaster-proposals/analytics
// ─────────────────────────────────────────────────
describe('GET /api/broadcaster-proposals/analytics', () => {
  it('retorna analytics da emissora com estrutura correta', async () => {
    const { auth } = await createBroadcasterWithProducts();

    const res = await request(app)
      .get('/api/broadcaster-proposals/analytics')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.analytics).toHaveProperty('total');
    expect(res.body.analytics).toHaveProperty('byStatus');
    expect(res.body.analytics).toHaveProperty('conversionRate');
  });

  it('retorna 403 para agency', async () => {
    const { auth } = await createAgency();

    const res = await request(app)
      .get('/api/broadcaster-proposals/analytics')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });

  it('retorna 401 sem autenticacao', async () => {
    const res = await request(app).get('/api/broadcaster-proposals/analytics');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────
// Broadcaster Clients (CRM)
// ─────────────────────────────────────────────────
describe('Broadcaster Clients', () => {
  it('GET /api/broadcaster-proposals/clients lista clientes da emissora', async () => {
    const { broadcaster, auth } = await createBroadcasterWithProducts();
    const AgencyClient = (await import('../../models/AgencyClient')).default;

    await AgencyClient.create({ broadcasterId: broadcaster._id, name: 'Cliente A', documentNumber: '12345678000100' });

    const res = await request(app)
      .get('/api/broadcaster-proposals/clients')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it('POST /api/broadcaster-proposals/clients cria cliente', async () => {
    const { auth } = await createBroadcasterWithProducts();

    const res = await request(app)
      .post('/api/broadcaster-proposals/clients')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'Novo Cliente', documentNumber: '98765432000100' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Novo Cliente');
  });

  it('POST /api/broadcaster-proposals/clients retorna 400 sem nome', async () => {
    const { auth } = await createBroadcasterWithProducts();

    const res = await request(app)
      .post('/api/broadcaster-proposals/clients')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ documentNumber: '12345678000199' });

    expect(res.status).toBe(400);
  });

  it('PUT /api/broadcaster-proposals/clients/:id atualiza cliente', async () => {
    const { broadcaster, auth } = await createBroadcasterWithProducts();
    const AgencyClient = (await import('../../models/AgencyClient')).default;
    const client = await AgencyClient.create({ broadcasterId: broadcaster._id, name: 'Antigo', documentNumber: '11111111000199' });

    const res = await request(app)
      .put(`/api/broadcaster-proposals/clients/${client._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'Atualizado' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Atualizado');
  });

  it('DELETE /api/broadcaster-proposals/clients/:id remove cliente', async () => {
    const { broadcaster, auth } = await createBroadcasterWithProducts();
    const AgencyClient = (await import('../../models/AgencyClient')).default;
    const client = await AgencyClient.create({ broadcasterId: broadcaster._id, name: 'Deletar', documentNumber: '22222222000199' });

    const res = await request(app)
      .delete(`/api/broadcaster-proposals/clients/${client._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/sucesso/i);
    const still = await AgencyClient.findById(client._id);
    expect(still).toBeNull();
  });

  it('DELETE /api/broadcaster-proposals/clients/:id retorna 404 para cliente de outra emissora', async () => {
    const { auth } = await createBroadcasterWithProducts();
    const { broadcaster: outra } = await createBroadcasterWithProducts();
    const AgencyClient = (await import('../../models/AgencyClient')).default;
    const client = await AgencyClient.create({ broadcasterId: outra._id, name: 'Alheio', documentNumber: '33333333000199' });

    const res = await request(app)
      .delete(`/api/broadcaster-proposals/clients/${client._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────
// Client Types CRUD
// ─────────────────────────────────────────────────
describe('Broadcaster Client Types', () => {
  it('GET /api/broadcaster-proposals/client-types lista tipos', async () => {
    const { auth } = await createBroadcasterWithProducts();
    const res = await request(app)
      .get('/api/broadcaster-proposals/client-types')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('POST /api/broadcaster-proposals/client-types cria tipo', async () => {
    const { auth } = await createBroadcasterWithProducts();
    const res = await request(app)
      .post('/api/broadcaster-proposals/client-types')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'Pessoa Jurídica' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Pessoa Jurídica');
  });

  it('POST /api/broadcaster-proposals/client-types retorna 400 sem nome', async () => {
    const { auth } = await createBroadcasterWithProducts();
    const res = await request(app)
      .post('/api/broadcaster-proposals/client-types')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({});
    expect(res.status).toBe(400);
  });

  it('PUT /api/broadcaster-proposals/client-types/:id atualiza tipo', async () => {
    const { broadcaster, auth } = await createBroadcasterWithProducts();
    const ClientType = (await import('../../models/ClientType')).default;
    const tipo = await ClientType.create({ broadcasterId: broadcaster._id, name: 'Antigo' });

    const res = await request(app)
      .put(`/api/broadcaster-proposals/client-types/${tipo._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'Atualizado' });
    expect(res.status).toBe(200);
  });

  it('DELETE /api/broadcaster-proposals/client-types/:id remove tipo', async () => {
    const { broadcaster, auth } = await createBroadcasterWithProducts();
    const ClientType = (await import('../../models/ClientType')).default;
    const tipo = await ClientType.create({ broadcasterId: broadcaster._id, name: 'Deletar' });

    const res = await request(app)
      .delete(`/api/broadcaster-proposals/client-types/${tipo._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────
// Client Origins CRUD
// ─────────────────────────────────────────────────
describe('Broadcaster Client Origins', () => {
  it('GET /api/broadcaster-proposals/client-origins lista origens', async () => {
    const { auth } = await createBroadcasterWithProducts();
    const res = await request(app)
      .get('/api/broadcaster-proposals/client-origins')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('POST /api/broadcaster-proposals/client-origins cria origem', async () => {
    const { auth } = await createBroadcasterWithProducts();
    const res = await request(app)
      .post('/api/broadcaster-proposals/client-origins')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'Indicação' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Indicação');
  });

  it('PUT /api/broadcaster-proposals/client-origins/:id atualiza origem', async () => {
    const { broadcaster, auth } = await createBroadcasterWithProducts();
    const ClientOrigin = (await import('../../models/ClientOrigin')).default;
    const origem = await ClientOrigin.create({ broadcasterId: broadcaster._id, name: 'Antiga' });

    const res = await request(app)
      .put(`/api/broadcaster-proposals/client-origins/${origem._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'Nova Origem' });
    expect(res.status).toBe(200);
  });

  it('DELETE /api/broadcaster-proposals/client-origins/:id remove origem', async () => {
    const { broadcaster, auth } = await createBroadcasterWithProducts();
    const ClientOrigin = (await import('../../models/ClientOrigin')).default;
    const origem = await ClientOrigin.create({ broadcasterId: broadcaster._id, name: 'Deletar' });

    const res = await request(app)
      .delete(`/api/broadcaster-proposals/client-origins/${origem._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────
// Versionamento
// ─────────────────────────────────────────────────
describe('GET /api/broadcaster-proposals/:id/versions', () => {
  it('retorna lista de versoes da proposta', async () => {
    const { broadcaster, auth } = await createBroadcasterWithProducts();

    const proposal = await Proposal.create({
      broadcasterId: broadcaster._id,
      ownerType: 'broadcaster',
      title: 'Com Versoes',
      slug: `bp-versions-${Date.now()}`,
      items: [],
      grossAmount: 0,
      totalAmount: 0,
      status: 'draft',
    });

    const res = await request(app)
      .get(`/api/broadcaster-proposals/${proposal._id}/versions`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.versions).toBeDefined();
    expect(Array.isArray(res.body.versions)).toBe(true);
  });
});

describe('POST /api/broadcaster-proposals/:id/versions/:versionId/restore', () => {
  it('restaura proposta a partir de versao anterior', async () => {
    const { broadcaster, auth } = await createBroadcasterWithProducts();

    const proposal = await Proposal.create({
      broadcasterId: broadcaster._id,
      ownerType: 'broadcaster',
      title: 'Titulo Atual',
      slug: `bp-restore-${Date.now()}`,
      items: [{ productName: 'P', quantity: 1, unitPrice: 100, totalPrice: 100, productType: 'Comercial 30s' }],
      grossAmount: 100,
      totalAmount: 100,
      status: 'draft',
    });

    const version = await ProposalVersion.create({
      proposalId: proposal._id,
      version: 1,
      snapshot: {
        title: 'Titulo Antigo',
        items: [],
        grossAmount: 0,
        techFee: 0,
        productionCost: 0,
        agencyCommission: 0,
        agencyCommissionAmount: 0,
        monitoringCost: 0,
        discountAmount: 0,
        totalAmount: 0,
        customization: {},
      },
      changedBy: broadcaster._id,
      changeType: 'manual',
    });

    const res = await request(app)
      .post(`/api/broadcaster-proposals/${proposal._id}/versions/${version._id}/restore`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.proposal.title).toBe('Titulo Antigo');
  });

  it('retorna 404 para versao inexistente', async () => {
    const { broadcaster, auth } = await createBroadcasterWithProducts();
    const proposal = await Proposal.create({
      broadcasterId: broadcaster._id,
      ownerType: 'broadcaster',
      title: 'P',
      slug: `bp-restore-404-${Date.now()}`,
      items: [],
      grossAmount: 0,
      totalAmount: 0,
      status: 'draft',
    });

    const res = await request(app)
      .post(`/api/broadcaster-proposals/${proposal._id}/versions/${new mongoose.Types.ObjectId()}/restore`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────
// Comments + Protection
// ─────────────────────────────────────────────────
describe('POST /api/broadcaster-proposals/:id/comments', () => {
  it('adiciona comentario na proposta', async () => {
    const { broadcaster, auth } = await createBroadcasterWithProducts();
    const proposal = await Proposal.create({
      broadcasterId: broadcaster._id,
      ownerType: 'broadcaster',
      title: 'Para Comentar',
      slug: `bp-comment-${Date.now()}`,
      items: [],
      grossAmount: 0,
      totalAmount: 0,
      status: 'draft',
    });

    const res = await request(app)
      .post(`/api/broadcaster-proposals/${proposal._id}/comments`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ sectionId: 'header', text: 'Verificar preços', author: 'Vendedor' });

    expect(res.status).toBe(200);
    expect(res.body.comments.length).toBeGreaterThan(0);
  });

  it('retorna 400 sem campos obrigatorios', async () => {
    const { broadcaster, auth } = await createBroadcasterWithProducts();
    const proposal = await Proposal.create({
      broadcasterId: broadcaster._id,
      ownerType: 'broadcaster',
      title: 'P',
      slug: `bp-comment-400-${Date.now()}`,
      items: [],
      grossAmount: 0,
      totalAmount: 0,
      status: 'draft',
    });

    const res = await request(app)
      .post(`/api/broadcaster-proposals/${proposal._id}/comments`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ text: 'Sem secao' });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/broadcaster-proposals/:id/protection', () => {
  it('ativa protecao por PIN na proposta', async () => {
    const { broadcaster, auth } = await createBroadcasterWithProducts();
    const proposal = await Proposal.create({
      broadcasterId: broadcaster._id,
      ownerType: 'broadcaster',
      title: 'PIN Test',
      slug: `bp-pin-${Date.now()}`,
      items: [],
      grossAmount: 0,
      totalAmount: 0,
      status: 'sent',
    });

    const res = await request(app)
      .post(`/api/broadcaster-proposals/${proposal._id}/protection`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ enabled: true, pin: '5678' });

    expect(res.status).toBe(200);
    expect(res.body.protection?.enabled).toBe(true);
  });
});
