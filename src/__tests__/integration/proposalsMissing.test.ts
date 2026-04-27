/**
 * Integration Tests — Proposals API (Missing Coverage)
 *
 * Cobre funções ainda sem testes:
 * POST   /api/proposals/:id/convert          — convertToOrder
 * POST   /api/proposals/public/:slug/comments — addPublicComment
 * POST   /api/proposals/public/:slug/verify-pin — verifyPin
 * POST   /api/proposals/:id/upload            — uploadProposalImage
 * GET    /api/proposals/:id/export            — exportProposalXlsx
 * GET    /api/proposals/public/:slug/export   — exportPublicProposalXlsx
 * POST   /api/proposals/:id/versions/:id/restore — restoreVersion
 */

import '../helpers/mocks';

jest.mock('../../config/storage', () => ({
  uploadFile: jest.fn().mockResolvedValue('https://storage.googleapis.com/test-bucket/test.jpg'),
}));

import request from 'supertest';
import { Application } from 'express';
import express from 'express';
import cookieParser from 'cookie-parser';

import { mongoSanitize, xssSanitize, dedupeQuery } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';
import proposalRoutes from '../../routes/proposalRoutes';

import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { createAgency, createBroadcaster, createAdvertiser } from '../helpers/authHelper';
import { Product } from '../../models/Product';
import Proposal from '../../models/Proposal';
import ProposalVersion from '../../models/ProposalVersion';
import Order from '../../models/Order';

function createApp(): Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(mongoSanitize);
  app.use(xssSanitize);
  app.use(dedupeQuery);
  app.use(csrfProtection);
  app.use('/api/proposals', proposalRoutes);
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

async function createApprovedProposalWithProduct() {
  const { user: agency, auth: agencyAuth } = await createAgency();
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

  const proposal = await Proposal.create({
    agencyId: agency._id,
    ownerType: 'agency',
    title: 'Proposta de Teste',
    proposalNumber: 'PROP-TEST-001',
    slug: 'proposta-teste-001',
    status: 'approved',
    items: [
      {
        productId: product._id.toString(),
        productName: 'Comercial 30s',
        broadcasterName: 'Rádio Teste',
        broadcasterId: broadcaster._id.toString(),
        quantity: 10,
        unitPrice: 125,
        adjustedPrice: 125,
        totalPrice: 1250,
        isCustom: false,
        schedule: new Map(),
      },
    ],
    grossAmount: 1250,
    techFee: 62.5,
    totalAmount: 1312.5,
    customization: { primaryColor: '#000', secondaryColor: '#fff', layout: 'classic' },
    comments: [],
    statusHistory: [],
    viewSessions: [],
  });

  return { agency, agencyAuth, broadcaster, product, proposal };
}

// ─── convertToOrder ───────────────────────────────────────────────────────

describe('POST /api/proposals/:id/convert', () => {
  it('converte proposta aprovada em pedido', async () => {
    const { agencyAuth, proposal } = await createApprovedProposalWithProduct();

    const res = await request(app)
      .post(`/api/proposals/${proposal._id}/convert`)
      .set('Cookie', agencyAuth.cookieHeader)
      .set('X-CSRF-Token', agencyAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.order).toBeDefined();
    expect(res.body.order.status).toBe('pending_contact');
    expect(res.body.proposal.status).toBe('converted');

    const order = await Order.findById(res.body.order._id);
    expect(order).not.toBeNull();
  });

  it('retorna 400 se proposta nao esta aprovada', async () => {
    const { user: agency, auth: agencyAuth } = await createAgency();

    const proposal = await Proposal.create({
      agencyId: agency._id,
      ownerType: 'agency',
      title: 'Rascunho',
      proposalNumber: 'PROP-TEST-002',
      slug: 'proposta-draft-002',
      status: 'draft',
      items: [],
      grossAmount: 0,
      totalAmount: 0,
      customization: { primaryColor: '#000', secondaryColor: '#fff', layout: 'classic' },
      comments: [],
      statusHistory: [],
      viewSessions: [],
    });

    const res = await request(app)
      .post(`/api/proposals/${proposal._id}/convert`)
      .set('Cookie', agencyAuth.cookieHeader)
      .set('X-CSRF-Token', agencyAuth.csrfHeader);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/aprovada/i);
  });

  it('retorna 400 se proposta ja foi convertida (convertedOrderId setado)', async () => {
    const { user: agency, auth: agencyAuth } = await createAgency();
    const { user: broadcaster } = await createBroadcaster();
    const product = await Product.create({
      broadcasterId: broadcaster._id, spotType: 'Comercial 30s', duration: 30,
      timeSlot: 'Rotativo', netPrice: 100, pricePerInsertion: 125, isActive: true,
    });
    // Cria proposta ainda 'approved' mas com convertedOrderId já setado
    const proposal = await Proposal.create({
      agencyId: agency._id, ownerType: 'agency', title: 'Já Convertida',
      proposalNumber: 'PROP-TEST-004', slug: 'proposta-ja-convertida-004',
      status: 'approved', convertedOrderId: '507f1f77bcf86cd799439011',
      items: [{ productId: product._id.toString(), productName: 'Comercial 30s',
        broadcasterName: 'Rádio', broadcasterId: broadcaster._id.toString(),
        quantity: 1, unitPrice: 125, totalPrice: 125, isCustom: false, schedule: new Map() }],
      grossAmount: 125, totalAmount: 131.25,
      customization: { primaryColor: '#000', secondaryColor: '#fff', layout: 'classic' },
      comments: [], statusHistory: [], viewSessions: [],
    });

    const res = await request(app)
      .post(`/api/proposals/${proposal._id}/convert`)
      .set('Cookie', agencyAuth.cookieHeader)
      .set('X-CSRF-Token', agencyAuth.csrfHeader);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/já foi convertida/i);
  });

  it('retorna 400 se proposta nao tem itens de marketplace validos', async () => {
    const { user: agency, auth: agencyAuth } = await createAgency();

    const proposal = await Proposal.create({
      agencyId: agency._id,
      ownerType: 'agency',
      title: 'Só Customizados',
      proposalNumber: 'PROP-TEST-003',
      slug: 'proposta-custom-003',
      status: 'approved',
      items: [
        {
          productName: 'Item Personalizado',
          broadcasterName: 'Emissora X',
          quantity: 1,
          unitPrice: 500,
          totalPrice: 500,
          isCustom: true,
        },
      ],
      grossAmount: 500,
      totalAmount: 500,
      customization: { primaryColor: '#000', secondaryColor: '#fff', layout: 'classic' },
      comments: [],
      statusHistory: [],
      viewSessions: [],
    });

    const res = await request(app)
      .post(`/api/proposals/${proposal._id}/convert`)
      .set('Cookie', agencyAuth.cookieHeader)
      .set('X-CSRF-Token', agencyAuth.csrfHeader);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/itens válidos/i);
  });

  it('retorna 404 se proposta nao existe', async () => {
    const { auth: agencyAuth } = await createAgency();
    const fakeId = '507f1f77bcf86cd799439011';

    const res = await request(app)
      .post(`/api/proposals/${fakeId}/convert`)
      .set('Cookie', agencyAuth.cookieHeader)
      .set('X-CSRF-Token', agencyAuth.csrfHeader);

    expect(res.status).toBe(404);
  });

  it('retorna 403 para broadcaster', async () => {
    const { auth: broadcasterAuth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/proposals/507f1f77bcf86cd799439011/convert')
      .set('Cookie', broadcasterAuth.cookieHeader)
      .set('X-CSRF-Token', broadcasterAuth.csrfHeader);

    expect(res.status).toBe(403);
  });

  it('retorna 401 sem autenticacao', async () => {
    const res = await request(app)
      .post('/api/proposals/507f1f77bcf86cd799439011/convert');
    expect(res.status).toBe(401);
  });
});

// ─── addPublicComment ─────────────────────────────────────────────────────

describe('POST /api/proposals/public/:slug/comments', () => {
  it('adiciona comentario publico na proposta', async () => {
    const proposal = await Proposal.create({
      agencyId: '507f1f77bcf86cd799439011',
      ownerType: 'agency',
      title: 'Proposta Pública',
      proposalNumber: 'PROP-PUB-001',
      slug: 'proposta-publica-001',
      status: 'sent',
      items: [],
      grossAmount: 0,
      totalAmount: 0,
      customization: { primaryColor: '#000', secondaryColor: '#fff', layout: 'classic' },
      comments: [],
      statusHistory: [],
      viewSessions: [],
    });

    const res = await request(app)
      .post(`/api/proposals/public/${proposal.slug}/comments`)
      .send({ sectionId: 'hero', text: 'Ótima proposta!', author: 'João Silva', authorEmail: 'joao@cliente.com' });

    expect(res.status).toBe(200);
    expect(res.body.comments).toBeDefined();
    expect(Array.isArray(res.body.comments)).toBe(true);

    const updated = await Proposal.findById(proposal._id);
    expect(updated!.comments).toHaveLength(1);
  });

  it('retorna 400 se sectionId ou text ou author faltando', async () => {
    const proposal = await Proposal.create({
      agencyId: '507f1f77bcf86cd799439011',
      ownerType: 'agency',
      title: 'Proposta',
      proposalNumber: 'PROP-PUB-002',
      slug: 'proposta-publica-002',
      status: 'sent',
      items: [],
      grossAmount: 0,
      totalAmount: 0,
      customization: { primaryColor: '#000', secondaryColor: '#fff', layout: 'classic' },
      comments: [],
      statusHistory: [],
      viewSessions: [],
    });

    const res = await request(app)
      .post(`/api/proposals/public/${proposal.slug}/comments`)
      .send({ sectionId: 'hero', text: 'Texto sem autor' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('retorna 404 para slug inexistente', async () => {
    const res = await request(app)
      .post('/api/proposals/public/slug-inexistente-xyz/comments')
      .send({ sectionId: 'hero', text: 'Comentário', author: 'Alguém' });

    expect(res.status).toBe(404);
  });
});

// ─── verifyPin ────────────────────────────────────────────────────────────

describe('POST /api/proposals/public/:slug/verify-pin', () => {
  it('retorna verified: true para PIN correto', async () => {
    const proposal = await Proposal.create({
      agencyId: '507f1f77bcf86cd799439011',
      ownerType: 'agency',
      title: 'Proposta Protegida',
      proposalNumber: 'PROP-PIN-001',
      slug: 'proposta-pin-001',
      status: 'sent',
      items: [],
      grossAmount: 0,
      totalAmount: 0,
      protection: {
        enabled: true,
        pin: '1234',
        failedAttempts: 0,
      },
      customization: { primaryColor: '#000', secondaryColor: '#fff', layout: 'classic' },
      comments: [],
      statusHistory: [],
      viewSessions: [],
    });

    const res = await request(app)
      .post(`/api/proposals/public/${proposal.slug}/verify-pin`)
      .send({ pin: '1234' });

    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
  });

  it('retorna 401 para PIN incorreto', async () => {
    await Proposal.create({
      agencyId: '507f1f77bcf86cd799439011',
      ownerType: 'agency',
      title: 'Proposta Protegida',
      proposalNumber: 'PROP-PIN-002',
      slug: 'proposta-pin-002',
      status: 'sent',
      items: [],
      grossAmount: 0,
      totalAmount: 0,
      protection: { enabled: true, pin: '1234', failedAttempts: 0 },
      customization: { primaryColor: '#000', secondaryColor: '#fff', layout: 'classic' },
      comments: [],
      statusHistory: [],
      viewSessions: [],
    });

    const res = await request(app)
      .post('/api/proposals/public/proposta-pin-002/verify-pin')
      .send({ pin: '9999' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/incorreto/i);
  });

  it('retorna 401 para PIN incorreto (sem lockout)', async () => {
    await Proposal.create({
      agencyId: '507f1f77bcf86cd799439011',
      ownerType: 'agency',
      title: 'Proposta Contador',
      proposalNumber: 'PROP-PIN-003',
      slug: 'proposta-pin-003-counter',
      status: 'sent',
      items: [],
      grossAmount: 0,
      totalAmount: 0,
      protection: { enabled: true, pin: '9999' },
      customization: { primaryColor: '#000', secondaryColor: '#fff', layout: 'classic' },
      comments: [],
      statusHistory: [],
      viewSessions: [],
    });

    const res = await request(app)
      .post('/api/proposals/public/proposta-pin-003-counter/verify-pin')
      .send({ pin: '0000' });

    // Pode ser 401 (PIN errado) ou 429 (rate limiter atingido no test env)
    expect([401, 429]).toContain(res.status);
  });

  it('retorna 410 para PIN expirado', async () => {
    const pastDate = new Date(Date.now() - 1000 * 60 * 60);
    await Proposal.create({
      agencyId: '507f1f77bcf86cd799439011',
      ownerType: 'agency',
      title: 'Proposta Expirada',
      proposalNumber: 'PROP-PIN-004',
      slug: 'proposta-pin-004',
      status: 'sent',
      items: [],
      grossAmount: 0,
      totalAmount: 0,
      protection: { enabled: true, pin: '1234', failedAttempts: 0, expiresAt: pastDate },
      customization: { primaryColor: '#000', secondaryColor: '#fff', layout: 'classic' },
      comments: [],
      statusHistory: [],
      viewSessions: [],
    });

    const res = await request(app)
      .post('/api/proposals/public/proposta-pin-004/verify-pin')
      .send({ pin: '1234' });

    expect(res.status).toBe(410);
  });

  it('retorna verified: true se protecao desabilitada', async () => {
    await Proposal.create({
      agencyId: '507f1f77bcf86cd799439011',
      ownerType: 'agency',
      title: 'Sem Protecao',
      proposalNumber: 'PROP-PIN-005',
      slug: 'proposta-sem-pin-005',
      status: 'sent',
      items: [],
      grossAmount: 0,
      totalAmount: 0,
      protection: { enabled: false },
      customization: { primaryColor: '#000', secondaryColor: '#fff', layout: 'classic' },
      comments: [],
      statusHistory: [],
      viewSessions: [],
    });

    const res = await request(app)
      .post('/api/proposals/public/proposta-sem-pin-005/verify-pin')
      .send({ pin: 'qualquer' });

    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
  });

  it('retorna 404 para slug inexistente', async () => {
    const res = await request(app)
      .post('/api/proposals/public/slug-inexistente-xyz/verify-pin')
      .send({ pin: '1234' });
    expect([404, 429]).toContain(res.status);
  });
});

// ─── uploadProposalImage ─────────────────────────────────────────────────

describe('POST /api/proposals/:id/upload', () => {
  it('faz upload de logo da proposta', async () => {
    const { user: agency, auth: agencyAuth } = await createAgency();
    const proposal = await Proposal.create({
      agencyId: agency._id,
      ownerType: 'agency',
      title: 'Upload Test',
      proposalNumber: 'PROP-UPL-001',
      slug: 'proposta-upload-001',
      status: 'draft',
      items: [],
      grossAmount: 0,
      totalAmount: 0,
      customization: { primaryColor: '#000', secondaryColor: '#fff', layout: 'classic' },
      comments: [],
      statusHistory: [],
      viewSessions: [],
    });

    const res = await request(app)
      .post(`/api/proposals/${proposal._id}/upload?type=logo`)
      .set('Cookie', agencyAuth.cookieHeader)
      .set('X-CSRF-Token', agencyAuth.csrfHeader)
      .attach('file', Buffer.from('fake-image-data'), { filename: 'logo.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body.url).toBeDefined();
  });

  it('faz upload de cover da proposta', async () => {
    const { user: agency, auth: agencyAuth } = await createAgency();
    const proposal = await Proposal.create({
      agencyId: agency._id,
      ownerType: 'agency',
      title: 'Cover Test',
      proposalNumber: 'PROP-UPL-002',
      slug: 'proposta-upload-002',
      status: 'draft',
      items: [],
      grossAmount: 0,
      totalAmount: 0,
      customization: { primaryColor: '#000', secondaryColor: '#fff', layout: 'classic' },
      comments: [],
      statusHistory: [],
      viewSessions: [],
    });

    const res = await request(app)
      .post(`/api/proposals/${proposal._id}/upload?type=cover`)
      .set('Cookie', agencyAuth.cookieHeader)
      .set('X-CSRF-Token', agencyAuth.csrfHeader)
      .attach('file', Buffer.from('fake-image-data'), { filename: 'cover.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body.url).toBeDefined();
  });

  it('retorna 400 se nenhum arquivo enviado', async () => {
    const { user: agency, auth: agencyAuth } = await createAgency();
    const proposal = await Proposal.create({
      agencyId: agency._id,
      ownerType: 'agency',
      title: 'Sem Arquivo',
      proposalNumber: 'PROP-UPL-003',
      slug: 'proposta-upload-003',
      status: 'draft',
      items: [],
      grossAmount: 0,
      totalAmount: 0,
      customization: { primaryColor: '#000', secondaryColor: '#fff', layout: 'classic' },
      comments: [],
      statusHistory: [],
      viewSessions: [],
    });

    const res = await request(app)
      .post(`/api/proposals/${proposal._id}/upload?type=logo`)
      .set('Cookie', agencyAuth.cookieHeader)
      .set('X-CSRF-Token', agencyAuth.csrfHeader);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/arquivo/i);
  });

  it('retorna 400 para type invalido', async () => {
    const { user: agency, auth: agencyAuth } = await createAgency();
    const proposal = await Proposal.create({
      agencyId: agency._id,
      ownerType: 'agency',
      title: 'Type Inválido',
      proposalNumber: 'PROP-UPL-004',
      slug: 'proposta-upload-004',
      status: 'draft',
      items: [],
      grossAmount: 0,
      totalAmount: 0,
      customization: { primaryColor: '#000', secondaryColor: '#fff', layout: 'classic' },
      comments: [],
      statusHistory: [],
      viewSessions: [],
    });

    const res = await request(app)
      .post(`/api/proposals/${proposal._id}/upload?type=banner`)
      .set('Cookie', agencyAuth.cookieHeader)
      .set('X-CSRF-Token', agencyAuth.csrfHeader)
      .attach('file', Buffer.from('data'), { filename: 'img.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/logo.*cover|tipo/i);
  });

  it('retorna 404 se proposta nao existe', async () => {
    const { auth: agencyAuth } = await createAgency();
    const res = await request(app)
      .post('/api/proposals/507f1f77bcf86cd799439011/upload?type=logo')
      .set('Cookie', agencyAuth.cookieHeader)
      .set('X-CSRF-Token', agencyAuth.csrfHeader)
      .attach('file', Buffer.from('data'), { filename: 'img.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(404);
  });

  it('retorna 403 para broadcaster', async () => {
    const { auth: broadcasterAuth } = await createBroadcaster();
    const res = await request(app)
      .post('/api/proposals/507f1f77bcf86cd799439011/upload?type=logo')
      .set('Cookie', broadcasterAuth.cookieHeader)
      .set('X-CSRF-Token', broadcasterAuth.csrfHeader)
      .attach('file', Buffer.from('data'), { filename: 'img.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(403);
  });
});

// ─── exportProposalXlsx ───────────────────────────────────────────────────

describe('GET /api/proposals/:id/export', () => {
  it('exporta proposta como xlsx', async () => {
    const { user: agency, auth: agencyAuth } = await createAgency();
    const proposal = await Proposal.create({
      agencyId: agency._id,
      ownerType: 'agency',
      title: 'Proposta Export',
      proposalNumber: 'PROP-EXP-001',
      slug: 'proposta-export-001',
      status: 'sent',
      items: [
        {
          productName: 'Comercial 30s',
          broadcasterName: 'Rádio Teste',
          broadcasterId: '507f1f77bcf86cd799439011',
          quantity: 5,
          unitPrice: 100,
          totalPrice: 500,
          isCustom: false,
        },
      ],
      grossAmount: 500,
      totalAmount: 525,
      customization: { primaryColor: '#000', secondaryColor: '#fff', layout: 'classic' },
      comments: [],
      statusHistory: [],
      viewSessions: [],
    });

    const res = await request(app)
      .get(`/api/proposals/${proposal._id}/export`)
      .set('Cookie', agencyAuth.cookieHeader)
      .set('X-CSRF-Token', agencyAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheet|octet-stream/i);
  });

  it('retorna 403 para broadcaster', async () => {
    const { auth: broadcasterAuth } = await createBroadcaster();
    const res = await request(app)
      .get('/api/proposals/507f1f77bcf86cd799439011/export')
      .set('Cookie', broadcasterAuth.cookieHeader)
      .set('X-CSRF-Token', broadcasterAuth.csrfHeader);

    expect(res.status).toBe(403);
  });

  it('retorna 404 para proposta inexistente', async () => {
    const { auth: agencyAuth } = await createAgency();
    const res = await request(app)
      .get('/api/proposals/507f1f77bcf86cd799439011/export')
      .set('Cookie', agencyAuth.cookieHeader)
      .set('X-CSRF-Token', agencyAuth.csrfHeader);

    expect(res.status).toBe(404);
  });
});

// ─── exportPublicProposalXlsx ─────────────────────────────────────────────

describe('GET /api/proposals/public/:slug/export', () => {
  it('exporta proposta publica enviada', async () => {
    await Proposal.create({
      agencyId: '507f1f77bcf86cd799439011',
      ownerType: 'agency',
      title: 'Proposta Pública Export',
      proposalNumber: 'PROP-PUB-EXP-001',
      slug: 'proposta-pub-export-001',
      status: 'sent',
      items: [
        {
          productName: 'Spot 30s',
          broadcasterName: 'Rádio X',
          broadcasterId: '507f1f77bcf86cd799439011',
          quantity: 2,
          unitPrice: 200,
          totalPrice: 400,
          isCustom: false,
        },
      ],
      grossAmount: 400,
      totalAmount: 420,
      customization: { primaryColor: '#000', secondaryColor: '#fff', layout: 'classic' },
      comments: [],
      statusHistory: [],
      viewSessions: [],
    });

    const res = await request(app)
      .get('/api/proposals/public/proposta-pub-export-001/export');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheet|octet-stream/i);
  });

  it('retorna 404 para proposta em status invalido (draft)', async () => {
    await Proposal.create({
      agencyId: '507f1f77bcf86cd799439011',
      ownerType: 'agency',
      title: 'Draft',
      proposalNumber: 'PROP-DRAFT-EXP',
      slug: 'proposta-draft-exp',
      status: 'draft',
      items: [],
      grossAmount: 0,
      totalAmount: 0,
      customization: { primaryColor: '#000', secondaryColor: '#fff', layout: 'classic' },
      comments: [],
      statusHistory: [],
      viewSessions: [],
    });

    const res = await request(app)
      .get('/api/proposals/public/proposta-draft-exp/export');

    expect(res.status).toBe(404);
  });

  it('retorna 404 para slug inexistente', async () => {
    const res = await request(app)
      .get('/api/proposals/public/slug-nao-existe-abc/export');
    expect(res.status).toBe(404);
  });
});

// ─── restoreVersion ───────────────────────────────────────────────────────

describe('POST /api/proposals/:id/versions/:versionId/restore', () => {
  it('restaura proposta a partir de versao anterior', async () => {
    const { user: agency, auth: agencyAuth } = await createAgency();

    const proposal = await Proposal.create({
      agencyId: agency._id,
      ownerType: 'agency',
      title: 'Título Atual',
      proposalNumber: 'PROP-VER-001',
      slug: 'proposta-versao-001',
      status: 'draft',
      items: [],
      grossAmount: 500,
      totalAmount: 525,
      customization: { primaryColor: '#000', secondaryColor: '#fff', layout: 'classic' },
      comments: [],
      statusHistory: [],
      viewSessions: [],
    });

    const version = await ProposalVersion.create({
      proposalId: proposal._id,
      version: 1,
      snapshot: {
        title: 'Título da Versão 1',
        items: [],
        grossAmount: 300,
        totalAmount: 315,
        customization: { primaryColor: '#111', secondaryColor: '#eee', layout: 'modern' },
      },
      changedBy: agency._id,
      changeType: 'manual',
    });

    const res = await request(app)
      .post(`/api/proposals/${proposal._id}/versions/${version._id}/restore`)
      .set('Cookie', agencyAuth.cookieHeader)
      .set('X-CSRF-Token', agencyAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.proposal.title).toBe('Título da Versão 1');
    expect(res.body.proposal.grossAmount).toBe(300);
  });

  it('retorna 404 para versao inexistente', async () => {
    const { user: agency, auth: agencyAuth } = await createAgency();
    const proposal = await Proposal.create({
      agencyId: agency._id,
      ownerType: 'agency',
      title: 'Proposta',
      proposalNumber: 'PROP-VER-002',
      slug: 'proposta-versao-002',
      status: 'draft',
      items: [],
      grossAmount: 0,
      totalAmount: 0,
      customization: { primaryColor: '#000', secondaryColor: '#fff', layout: 'classic' },
      comments: [],
      statusHistory: [],
      viewSessions: [],
    });

    const res = await request(app)
      .post(`/api/proposals/${proposal._id}/versions/507f1f77bcf86cd799439011/restore`)
      .set('Cookie', agencyAuth.cookieHeader)
      .set('X-CSRF-Token', agencyAuth.csrfHeader);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/versão/i);
  });

  it('retorna 404 para proposta inexistente', async () => {
    const { auth: agencyAuth } = await createAgency();
    const res = await request(app)
      .post('/api/proposals/507f1f77bcf86cd799439011/versions/507f1f77bcf86cd799439011/restore')
      .set('Cookie', agencyAuth.cookieHeader)
      .set('X-CSRF-Token', agencyAuth.csrfHeader);

    expect(res.status).toBe(404);
  });

  it('retorna 403 para advertiser', async () => {
    const { auth: advertiserAuth } = await createAdvertiser();
    const res = await request(app)
      .post('/api/proposals/507f1f77bcf86cd799439011/versions/507f1f77bcf86cd799439011/restore')
      .set('Cookie', advertiserAuth.cookieHeader)
      .set('X-CSRF-Token', advertiserAuth.csrfHeader);

    expect(res.status).toBe(403);
  });
});
