/**
 * Integration Tests — Proposals API (Agency)
 *
 * Tests real HTTP endpoints end-to-end.
 * POST   /api/proposals
 * GET    /api/proposals
 * GET    /api/proposals/:id
 * PUT    /api/proposals/:id
 * DELETE /api/proposals/:id
 * POST   /api/proposals/:id/duplicate
 * POST   /api/proposals/:id/send
 * PUT    /api/proposals/:id/customization
 * GET    /api/proposals/public/:slug
 * POST   /api/proposals/public/:slug/respond
 * POST   /api/proposals/public/:slug/view
 * GET    /api/proposals/templates
 * POST   /api/proposals/templates
 * POST   /api/proposals/:id/comments
 * POST   /api/proposals/:id/protection
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
import {
  createAgency,
  createBroadcaster,
  createAdvertiser,
  createAdmin,
} from '../helpers/authHelper';
import { Product } from '../../models/Product';
import Proposal from '../../models/Proposal';
import ProposalTemplate from '../../models/ProposalTemplate';

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
  app = createProposalTestApp();
});

afterEach(async () => {
  await clearTestDB();
});

afterAll(async () => {
  await disconnectTestDB();
});

/**
 * Helper: creates an approved broadcaster with an active product for proposal tests.
 */
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

// ─────────────────────────────────────────────────
// POST /api/proposals (create proposal)
// ─────────────────────────────────────────────────
describe('POST /api/proposals', () => {
  it('should allow agency to create a proposal with marketplace items', async () => {
    const { auth } = await createAgency();
    const { broadcaster, product } = await createBroadcasterWithProduct();

    const res = await request(app)
      .post('/api/proposals')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        title: 'Proposta Teste',
        items: [
          {
            productId: product._id.toString(),
            broadcasterId: broadcaster._id.toString(),
            broadcasterName: 'Radio Test FM',
            quantity: 10,
          },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.proposal).toBeDefined();
    expect(res.body.proposal.title).toBe('Proposta Teste');
    expect(res.body.proposal.items).toHaveLength(1);
    expect(res.body.proposal.status).toBe('draft');
    expect(res.body.proposal.proposalNumber).toMatch(/^PROP-/);
    expect(res.body.proposal.slug).toBeDefined();
  });

  it('should reject when items are missing', async () => {
    const { auth } = await createAgency();

    const res = await request(app)
      .post('/api/proposals')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ title: 'Proposta Vazia' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/obrigatórios/i);
  });

  it('should reject when non-agency user tries to create proposal', async () => {
    const { auth } = await createAdvertiser();
    const { product } = await createBroadcasterWithProduct();

    const res = await request(app)
      .post('/api/proposals')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        title: 'Proposta Advertiser',
        items: [{ productId: product._id.toString(), quantity: 5 }],
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/agências/i);
  });

  it('should return 401 when unauthenticated', async () => {
    const res = await request(app)
      .post('/api/proposals')
      .send({ title: 'Sem Auth', items: [{ productId: 'fake', quantity: 1 }] });

    expect(res.status).toBe(401);
  });

  it('should return 400 for non-existent product', async () => {
    const { auth } = await createAgency();
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .post('/api/proposals')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        title: 'Proposta Produto Fantasma',
        items: [{ productId: fakeId.toString(), quantity: 5 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/não encontrado/i);
  });

  it('should calculate financial fields correctly', async () => {
    const { auth } = await createAgency();
    const { product } = await createBroadcasterWithProduct();

    const res = await request(app)
      .post('/api/proposals')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        title: 'Proposta Calculo',
        items: [{ productId: product._id.toString(), quantity: 10 }],
        agencyCommission: 10,
      });

    expect(res.status).toBe(201);
    const p = res.body.proposal;
    // grossAmount = 125 * 10 = 1250
    expect(p.grossAmount).toBe(1250);
    // techFee = 5% of grossAmount = 62.5
    expect(p.techFee).toBe(62.5);
    // agencyCommissionAmount = 10% of 1250 = 125
    expect(p.agencyCommissionAmount).toBe(125);
    // totalAmount = 1250 + 62.5 + 125 = 1437.5
    expect(p.totalAmount).toBe(1437.5);
  });

  it('should support custom items without productId', async () => {
    const { auth } = await createAgency();

    const res = await request(app)
      .post('/api/proposals')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        title: 'Proposta Custom',
        items: [
          {
            isCustom: true,
            productName: 'Servico Extra',
            unitPrice: 500,
            quantity: 2,
          },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.proposal.items[0].isCustom).toBe(true);
    expect(res.body.proposal.grossAmount).toBe(1000);
  });
});

// ─────────────────────────────────────────────────
// GET /api/proposals (list proposals)
// ─────────────────────────────────────────────────
describe('GET /api/proposals', () => {
  it('should list proposals for the authenticated agency', async () => {
    const { user: agency, auth } = await createAgency();

    // Create proposal directly
    await Proposal.create({
      agencyId: agency._id,
      title: 'Proposta Listada',
      slug: `test-slug-${Date.now()}`,
      items: [{ productName: 'Comercial 30s', quantity: 5, unitPrice: 125, totalPrice: 625, productType: 'Comercial 30s' }],
      grossAmount: 625,
      totalAmount: 625,
      status: 'draft',
    });

    const res = await request(app)
      .get('/api/proposals')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.proposals).toHaveLength(1);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.total).toBe(1);
  });

  it('should not list proposals from other agencies', async () => {
    const { user: agency1 } = await createAgency();
    const { auth: auth2 } = await createAgency();

    await Proposal.create({
      agencyId: agency1._id,
      title: 'Proposta Alheia',
      slug: `slug-other-${Date.now()}`,
      items: [{ productName: 'Comercial 30s', quantity: 1, unitPrice: 100, totalPrice: 100, productType: 'Comercial 30s' }],
      grossAmount: 100,
      totalAmount: 100,
      status: 'draft',
    });

    const res = await request(app)
      .get('/api/proposals')
      .set('Cookie', auth2.cookieHeader)
      .set('X-CSRF-Token', auth2.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.proposals).toHaveLength(0);
  });

  it('should filter by status', async () => {
    const { user: agency, auth } = await createAgency();

    await Proposal.create([
      { agencyId: agency._id, title: 'Draft', slug: `d-${Date.now()}-1`, items: [{ productName: 'P', quantity: 1, unitPrice: 100, totalPrice: 100, productType: 'Comercial 30s' }], grossAmount: 100, totalAmount: 100, status: 'draft' },
      { agencyId: agency._id, title: 'Sent', slug: `s-${Date.now()}-2`, items: [{ productName: 'P', quantity: 1, unitPrice: 100, totalPrice: 100, productType: 'Comercial 30s' }], grossAmount: 100, totalAmount: 100, status: 'sent' },
    ]);

    const res = await request(app)
      .get('/api/proposals?status=sent')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.proposals).toHaveLength(1);
    expect(res.body.proposals[0].status).toBe('sent');
  });

  it('should reject non-agency users', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .get('/api/proposals')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────
// GET /api/proposals/:id
// ─────────────────────────────────────────────────
describe('GET /api/proposals/:id', () => {
  it('should return proposal details for the owner agency', async () => {
    const { user: agency, auth } = await createAgency();

    const proposal = await Proposal.create({
      agencyId: agency._id,
      title: 'Detalhe Teste',
      slug: `detail-${Date.now()}`,
      items: [{ productName: 'Comercial 30s', quantity: 3, unitPrice: 125, totalPrice: 375, productType: 'Comercial 30s' }],
      grossAmount: 375,
      totalAmount: 375,
      status: 'draft',
    });

    const res = await request(app)
      .get(`/api/proposals/${proposal._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.proposal.title).toBe('Detalhe Teste');
  });

  it('should return 404 for non-existent proposal', async () => {
    const { auth } = await createAgency();
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .get(`/api/proposals/${fakeId}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(404);
  });

  it('should return 404 when another agency tries to access', async () => {
    const { user: agency1 } = await createAgency();
    const { auth: auth2 } = await createAgency();

    const proposal = await Proposal.create({
      agencyId: agency1._id,
      title: 'Proposta Privada',
      slug: `private-${Date.now()}`,
      items: [{ productName: 'P', quantity: 1, unitPrice: 100, totalPrice: 100, productType: 'Comercial 30s' }],
      grossAmount: 100,
      totalAmount: 100,
      status: 'draft',
    });

    const res = await request(app)
      .get(`/api/proposals/${proposal._id}`)
      .set('Cookie', auth2.cookieHeader)
      .set('X-CSRF-Token', auth2.csrfHeader);

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────
// PUT /api/proposals/:id (update)
// ─────────────────────────────────────────────────
describe('PUT /api/proposals/:id', () => {
  it('should update proposal title and description', async () => {
    const { user: agency, auth } = await createAgency();

    const proposal = await Proposal.create({
      agencyId: agency._id,
      title: 'Titulo Original',
      slug: `update-${Date.now()}`,
      items: [{ productName: 'Comercial 30s', quantity: 5, unitPrice: 125, totalPrice: 625, productType: 'Comercial 30s' }],
      grossAmount: 625,
      totalAmount: 625,
      status: 'draft',
    });

    const res = await request(app)
      .put(`/api/proposals/${proposal._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ title: 'Titulo Atualizado', description: 'Nova descricao' });

    expect(res.status).toBe(200);
    expect(res.body.proposal.title).toBe('Titulo Atualizado');
    expect(res.body.proposal.description).toBe('Nova descricao');
  });

  it('should recalculate financials when items change', async () => {
    const { user: agency, auth } = await createAgency();

    const proposal = await Proposal.create({
      agencyId: agency._id,
      title: 'Recalcular',
      slug: `recalc-${Date.now()}`,
      items: [{ productName: 'Comercial 30s', quantity: 5, unitPrice: 100, totalPrice: 500, productType: 'Comercial 30s' }],
      grossAmount: 500,
      techFee: 25,
      agencyCommission: 0,
      agencyCommissionAmount: 0,
      monitoringCost: 0,
      totalAmount: 525,
      status: 'draft',
    });

    const res = await request(app)
      .put(`/api/proposals/${proposal._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        items: [{ productName: 'Comercial 30s', quantity: 10, unitPrice: 100, totalPrice: 1000, productType: 'Comercial 30s' }],
      });

    expect(res.status).toBe(200);
    expect(res.body.proposal.grossAmount).toBe(1000);
    // techFee = 5% of 1000 = 50
    expect(res.body.proposal.techFee).toBe(50);
  });
});

// ─────────────────────────────────────────────────
// DELETE /api/proposals/:id
// ─────────────────────────────────────────────────
describe('DELETE /api/proposals/:id', () => {
  it('should delete proposal permanently', async () => {
    const { user: agency, auth } = await createAgency();

    const proposal = await Proposal.create({
      agencyId: agency._id,
      title: 'Para Excluir',
      slug: `delete-${Date.now()}`,
      items: [{ productName: 'P', quantity: 1, unitPrice: 100, totalPrice: 100, productType: 'Comercial 30s' }],
      grossAmount: 100,
      totalAmount: 100,
      status: 'draft',
    });

    const res = await request(app)
      .delete(`/api/proposals/${proposal._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/sucesso/i);

    const deleted = await Proposal.findById(proposal._id);
    expect(deleted).toBeNull();
  });

  it('should return 404 when deleting non-existent proposal', async () => {
    const { auth } = await createAgency();
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .delete(`/api/proposals/${fakeId}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────
// POST /api/proposals/:id/duplicate
// ─────────────────────────────────────────────────
describe('POST /api/proposals/:id/duplicate', () => {
  it('should duplicate a proposal as draft', async () => {
    const { user: agency, auth } = await createAgency();

    const original = await Proposal.create({
      agencyId: agency._id,
      title: 'Original',
      slug: `original-${Date.now()}`,
      items: [{ productName: 'Comercial 30s', quantity: 5, unitPrice: 125, totalPrice: 625, productType: 'Comercial 30s' }],
      grossAmount: 625,
      techFee: 31.25,
      totalAmount: 656.25,
      status: 'sent',
    });

    const res = await request(app)
      .post(`/api/proposals/${original._id}/duplicate`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(201);
    expect(res.body.proposal.title).toMatch(/Cópia de/);
    expect(res.body.proposal.status).toBe('draft');
    expect(res.body.proposal.slug).not.toBe(original.slug);
    expect(res.body.proposal.grossAmount).toBe(625);
  });
});

// ─────────────────────────────────────────────────
// POST /api/proposals/:id/send
// ─────────────────────────────────────────────────
describe('POST /api/proposals/:id/send', () => {
  it('should mark proposal as sent', async () => {
    const { user: agency, auth } = await createAgency();

    const proposal = await Proposal.create({
      agencyId: agency._id,
      title: 'Para Enviar',
      slug: `send-${Date.now()}`,
      items: [{ productName: 'P', quantity: 1, unitPrice: 100, totalPrice: 100, productType: 'Comercial 30s' }],
      grossAmount: 100,
      totalAmount: 100,
      status: 'draft',
    });

    const res = await request(app)
      .post(`/api/proposals/${proposal._id}/send`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.proposal.status).toBe('sent');
    expect(res.body.proposal.sentAt).toBeDefined();
    expect(res.body.publicUrl).toBeDefined();
  });

  it('should reject sending an already approved proposal', async () => {
    const { user: agency, auth } = await createAgency();

    const proposal = await Proposal.create({
      agencyId: agency._id,
      title: 'Aprovada',
      slug: `approved-${Date.now()}`,
      items: [{ productName: 'P', quantity: 1, unitPrice: 100, totalPrice: 100, productType: 'Comercial 30s' }],
      grossAmount: 100,
      totalAmount: 100,
      status: 'approved',
    });

    const res = await request(app)
      .post(`/api/proposals/${proposal._id}/send`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/rascunho/i);
  });
});

// ─────────────────────────────────────────────────
// PUT /api/proposals/:id/customization
// ─────────────────────────────────────────────────
describe('PUT /api/proposals/:id/customization', () => {
  it('should update customization fields', async () => {
    const { user: agency, auth } = await createAgency();

    const proposal = await Proposal.create({
      agencyId: agency._id,
      title: 'Custom Test',
      slug: `custom-${Date.now()}`,
      items: [{ productName: 'P', quantity: 1, unitPrice: 100, totalPrice: 100, productType: 'Comercial 30s' }],
      grossAmount: 100,
      totalAmount: 100,
      status: 'draft',
    });

    const res = await request(app)
      .put(`/api/proposals/${proposal._id}/customization`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        customization: {
          colors: { primary: '#ff0000' },
          fonts: { title: 'Arial' },
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.proposal).toBeDefined();
  });

  it('should reject when customization is missing', async () => {
    const { user: agency, auth } = await createAgency();

    const proposal = await Proposal.create({
      agencyId: agency._id,
      title: 'No Custom',
      slug: `nocustom-${Date.now()}`,
      items: [{ productName: 'P', quantity: 1, unitPrice: 100, totalPrice: 100, productType: 'Comercial 30s' }],
      grossAmount: 100,
      totalAmount: 100,
      status: 'draft',
    });

    const res = await request(app)
      .put(`/api/proposals/${proposal._id}/customization`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/obrigatórios/i);
  });
});

// ─────────────────────────────────────────────────
// GET /api/proposals/public/:slug
// ─────────────────────────────────────────────────
describe('GET /api/proposals/public/:slug', () => {
  it('should return public proposal data without auth', async () => {
    const { user: agency } = await createAgency();

    const slug = `public-test-${Date.now()}`;
    await Proposal.create({
      agencyId: agency._id,
      title: 'Proposta Publica',
      slug,
      items: [{ productName: 'Comercial 30s', quantity: 5, unitPrice: 125, totalPrice: 625, productType: 'Comercial 30s', netPrice: 100 }],
      grossAmount: 625,
      totalAmount: 625,
      status: 'sent',
    });

    const res = await request(app)
      .get(`/api/proposals/public/${slug}`);

    expect(res.status).toBe(200);
    expect(res.body.proposal).toBeDefined();
    expect(res.body.proposal.title).toBe('Proposta Publica');
    // netPrice should be filtered out from public view
    expect(res.body.proposal.items[0].netPrice).toBeUndefined();
  });

  it('should return 404 for non-existent slug', async () => {
    const res = await request(app)
      .get('/api/proposals/public/nonexistent-slug-12345');

    expect(res.status).toBe(404);
  });

  it('should return 410 for expired proposal', async () => {
    const { user: agency } = await createAgency();

    const slug = `expired-test-${Date.now()}`;
    await Proposal.create({
      agencyId: agency._id,
      title: 'Expirada',
      slug,
      items: [{ productName: 'P', quantity: 1, unitPrice: 100, totalPrice: 100, productType: 'Comercial 30s' }],
      grossAmount: 100,
      totalAmount: 100,
      status: 'expired',
    });

    const res = await request(app)
      .get(`/api/proposals/public/${slug}`);

    expect(res.status).toBe(410);
    expect(res.body.error).toMatch(/expirou/i);
  });

  it('should indicate protection when PIN is enabled', async () => {
    const { user: agency } = await createAgency();

    const slug = `protected-test-${Date.now()}`;
    await Proposal.create({
      agencyId: agency._id,
      title: 'Protegida',
      slug,
      items: [{ productName: 'P', quantity: 1, unitPrice: 100, totalPrice: 100, productType: 'Comercial 30s' }],
      grossAmount: 100,
      totalAmount: 100,
      status: 'sent',
      protection: { enabled: true, pin: '1234' },
    });

    const res = await request(app)
      .get(`/api/proposals/public/${slug}`);

    expect(res.status).toBe(200);
    expect(res.body.protected).toBe(true);
    expect(res.body.proposal).toBeNull();
  });
});

// ─────────────────────────────────────────────────
// POST /api/proposals/public/:slug/view (track view)
// ─────────────────────────────────────────────────
describe('POST /api/proposals/public/:slug/view', () => {
  it('should increment view count', async () => {
    const { user: agency } = await createAgency();

    const slug = `view-track-${Date.now()}`;
    await Proposal.create({
      agencyId: agency._id,
      title: 'View Tracked',
      slug,
      items: [{ productName: 'P', quantity: 1, unitPrice: 100, totalPrice: 100, productType: 'Comercial 30s' }],
      grossAmount: 100,
      totalAmount: 100,
      status: 'sent',
      viewCount: 0,
    });

    const res = await request(app)
      .post(`/api/proposals/public/${slug}/view`);

    expect(res.status).toBe(200);

    const updated = await Proposal.findOne({ slug });
    expect(updated!.viewCount).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────
// POST /api/proposals/public/:slug/respond
// ─────────────────────────────────────────────────
describe('POST /api/proposals/public/:slug/respond', () => {
  it('should approve a sent proposal', async () => {
    const { user: agency } = await createAgency();

    const slug = `respond-${Date.now()}`;
    await Proposal.create({
      agencyId: agency._id,
      title: 'Para Responder',
      slug,
      items: [{ productName: 'P', quantity: 1, unitPrice: 100, totalPrice: 100, productType: 'Comercial 30s' }],
      grossAmount: 100,
      totalAmount: 100,
      status: 'sent',
    });

    const res = await request(app)
      .post(`/api/proposals/public/${slug}/respond`)
      .send({ action: 'approve', approvalName: 'Cliente Teste', approvalEmail: 'cliente@teste.com' });

    expect(res.status).toBe(200);

    const updated = await Proposal.findOne({ slug });
    expect(updated!.status).toBe('approved');
    expect(updated!.approval?.name).toBe('Cliente Teste');
  });

  it('should reject a sent proposal', async () => {
    const { user: agency } = await createAgency();

    const slug = `reject-${Date.now()}`;
    await Proposal.create({
      agencyId: agency._id,
      title: 'Para Rejeitar',
      slug,
      items: [{ productName: 'P', quantity: 1, unitPrice: 100, totalPrice: 100, productType: 'Comercial 30s' }],
      grossAmount: 100,
      totalAmount: 100,
      status: 'sent',
    });

    const res = await request(app)
      .post(`/api/proposals/public/${slug}/respond`)
      .send({ action: 'reject', note: 'Nao aceito' });

    expect(res.status).toBe(200);

    const updated = await Proposal.findOne({ slug });
    expect(updated!.status).toBe('rejected');
  });
});

// ─────────────────────────────────────────────────
// Templates
// ─────────────────────────────────────────────────
describe('Proposal Templates', () => {
  it('GET /api/proposals/templates should return templates for the agency', async () => {
    const { user: agency, auth } = await createAgency();

    await ProposalTemplate.create({
      name: 'Template Teste',
      agencyId: agency._id,
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
      .get('/api/proposals/templates')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.templates.length).toBeGreaterThanOrEqual(1);
  });

  it('POST /api/proposals/templates should create a template', async () => {
    const { auth } = await createAgency();

    const res = await request(app)
      .post('/api/proposals/templates')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        name: 'Novo Template',
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
    expect(res.body.template.name).toBe('Novo Template');
  });
});

// ─────────────────────────────────────────────────
// POST /api/proposals/:id/comments
// ─────────────────────────────────────────────────
describe('POST /api/proposals/:id/comments', () => {
  it('should add a comment to a proposal', async () => {
    const { user: agency, auth } = await createAgency();

    const proposal = await Proposal.create({
      agencyId: agency._id,
      title: 'Com Comentario',
      slug: `comment-${Date.now()}`,
      items: [{ productName: 'P', quantity: 1, unitPrice: 100, totalPrice: 100, productType: 'Comercial 30s' }],
      grossAmount: 100,
      totalAmount: 100,
      status: 'sent',
    });

    const res = await request(app)
      .post(`/api/proposals/${proposal._id}/comments`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        sectionId: 'table',
        text: 'Precisa revisar os precos',
      });

    expect(res.status).toBe(200);
    expect(res.body.comments).toBeDefined();
    expect(res.body.comments.length).toBeGreaterThanOrEqual(1);
    expect(res.body.comments[res.body.comments.length - 1].text).toBe('Precisa revisar os precos');
  });
});

// ─────────────────────────────────────────────────
// POST /api/proposals/:id/protection
// ─────────────────────────────────────────────────
describe('POST /api/proposals/:id/protection', () => {
  it('should set PIN protection on a proposal', async () => {
    const { user: agency, auth } = await createAgency();

    const proposal = await Proposal.create({
      agencyId: agency._id,
      title: 'Proteger',
      slug: `protect-${Date.now()}`,
      items: [{ productName: 'P', quantity: 1, unitPrice: 100, totalPrice: 100, productType: 'Comercial 30s' }],
      grossAmount: 100,
      totalAmount: 100,
      status: 'draft',
    });

    const res = await request(app)
      .post(`/api/proposals/${proposal._id}/protection`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ enabled: true });

    expect(res.status).toBe(200);
    expect(res.body.protection).toBeDefined();
    expect(res.body.protection.enabled).toBe(true);

    const updated = await Proposal.findById(proposal._id);
    expect(updated!.protection?.enabled).toBe(true);
    // PIN should be auto-generated (6 digits)
    expect(updated!.protection?.pin).toMatch(/^\d{6}$/);
  });
});

// ─────────────────────────────────────────────────
// PUT /api/proposals/templates/:id
// ─────────────────────────────────────────────────
describe('PUT /api/proposals/templates/:id', () => {
  it('atualiza nome do template', async () => {
    const { user: agency, auth } = await createAgency();
    const template = await ProposalTemplate.create({
      name: 'Template Original',
      agencyId: agency._id,
      customization: { primaryColor: '#000000', secondaryColor: '#ffffff', backgroundColor: '#f0f0f0', textColor: '#333333', accentColor: '#0066cc', titleFont: 'Arial', bodyFont: 'Helvetica', sectionOrder: [], hiddenSections: [], hiddenElements: [], kpis: [], metrics: [], customSections: [], customTexts: {} },
    });

    const res = await request(app)
      .put(`/api/proposals/templates/${template._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'Template Atualizado' });

    expect(res.status).toBe(200);
    expect(res.body.template.name).toBe('Template Atualizado');
  });

  it('retorna 404 para template de outra agencia', async () => {
    const { auth } = await createAgency();
    const { user: outraAgencia } = await createAgency();
    const template = await ProposalTemplate.create({
      name: 'Template Alheio',
      agencyId: outraAgencia._id,
      customization: { primaryColor: '#000000', secondaryColor: '#ffffff', backgroundColor: '#f0f0f0', textColor: '#333333', accentColor: '#0066cc', titleFont: 'Arial', bodyFont: 'Helvetica', sectionOrder: [], hiddenSections: [], hiddenElements: [], kpis: [], metrics: [], customSections: [], customTexts: {} },
    });

    const res = await request(app)
      .put(`/api/proposals/templates/${template._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'Hack' });

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────
// DELETE /api/proposals/templates/:id
// ─────────────────────────────────────────────────
describe('DELETE /api/proposals/templates/:id', () => {
  it('deleta template da agencia', async () => {
    const { user: agency, auth } = await createAgency();
    const template = await ProposalTemplate.create({
      name: 'Para Deletar',
      agencyId: agency._id,
      customization: { primaryColor: '#000000', secondaryColor: '#ffffff', backgroundColor: '#f0f0f0', textColor: '#333333', accentColor: '#0066cc', titleFont: 'Arial', bodyFont: 'Helvetica', sectionOrder: [], hiddenSections: [], hiddenElements: [], kpis: [], metrics: [], customSections: [], customTexts: {} },
    });

    const res = await request(app)
      .delete(`/api/proposals/templates/${template._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/excluído/i);
    const still = await ProposalTemplate.findById(template._id);
    expect(still).toBeNull();
  });

  it('retorna 404 para template de outra agencia', async () => {
    const { auth } = await createAgency();
    const { user: outra } = await createAgency();
    const template = await ProposalTemplate.create({
      name: 'Alheio',
      agencyId: outra._id,
      customization: { primaryColor: '#000000', secondaryColor: '#ffffff', backgroundColor: '#f0f0f0', textColor: '#333333', accentColor: '#0066cc', titleFont: 'Arial', bodyFont: 'Helvetica', sectionOrder: [], hiddenSections: [], hiddenElements: [], kpis: [], metrics: [], customSections: [], customTexts: {} },
    });

    const res = await request(app)
      .delete(`/api/proposals/templates/${template._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────
// GET /api/proposals/analytics
// ─────────────────────────────────────────────────
describe('GET /api/proposals/analytics', () => {
  it('retorna analytics com estrutura correta', async () => {
    const { auth } = await createAgency();

    const res = await request(app)
      .get('/api/proposals/analytics')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.analytics).toHaveProperty('total');
    expect(res.body.analytics).toHaveProperty('byStatus');
    expect(res.body.analytics).toHaveProperty('conversionRate');
  });

  it('retorna 403 para broadcaster', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .get('/api/proposals/analytics')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });

  it('retorna 401 sem autenticacao', async () => {
    const res = await request(app).get('/api/proposals/analytics');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────
// GET /api/proposals/:id/versions
// ─────────────────────────────────────────────────
describe('GET /api/proposals/:id/versions', () => {
  it('retorna lista de versoes da proposta', async () => {
    const { user: agency, auth } = await createAgency();

    const proposal = await Proposal.create({
      agencyId: agency._id,
      title: 'Com Versoes',
      slug: `versions-${Date.now()}`,
      items: [{ productName: 'P', quantity: 1, unitPrice: 100, totalPrice: 100, productType: 'Comercial 30s' }],
      grossAmount: 100,
      totalAmount: 100,
      status: 'draft',
    });

    const res = await request(app)
      .get(`/api/proposals/${proposal._id}/versions`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.versions).toBeDefined();
    expect(Array.isArray(res.body.versions)).toBe(true);
  });

  it('retorna 404 para proposta de outra agencia', async () => {
    const { auth } = await createAgency();
    const { user: outra } = await createAgency();

    const proposal = await Proposal.create({
      agencyId: outra._id,
      title: 'Alheia',
      slug: `versions-other-${Date.now()}`,
      items: [],
      grossAmount: 0,
      totalAmount: 0,
      status: 'draft',
    });

    const res = await request(app)
      .get(`/api/proposals/${proposal._id}/versions`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(404);
  });
});
