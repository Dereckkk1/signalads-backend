/**
 * Integration Tests — Broadcaster Proposals API (Missing Coverage)
 *
 * Cobre funções ainda sem testes:
 * POST /api/broadcaster-proposals/:id/upload           — uploadProposalImage
 * GET  /api/broadcaster-proposals/:id/export           — exportProposalXlsx
 * POST /api/broadcaster-proposals/clients/:id/logo     — uploadBroadcasterClientLogo
 * POST /api/broadcaster-proposals/:id/versions/:id/restore — restoreVersion
 * POST /api/broadcaster-proposals/:id/protection       — setProtection
 */

import '../helpers/mocks';

jest.mock('../../config/storage', () => ({
  uploadFile: jest.fn().mockResolvedValue('https://storage.googleapis.com/test-bucket/client-logo.jpg'),
}));

import request from 'supertest';
import { Application } from 'express';
import express from 'express';
import cookieParser from 'cookie-parser';

import { mongoSanitize, xssSanitize, dedupeQuery } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';
import broadcasterProposalRoutes from '../../routes/broadcasterProposalRoutes';

import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { createBroadcaster, createAgency, createAdvertiser } from '../helpers/authHelper';
import { Product } from '../../models/Product';
import Proposal from '../../models/Proposal';
import ProposalVersion from '../../models/ProposalVersion';
import AgencyClient from '../../models/AgencyClient';

function createApp(): Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(mongoSanitize);
  app.use(xssSanitize);
  app.use(dedupeQuery);
  app.use(csrfProtection);
  app.use('/api/broadcaster-proposals', broadcasterProposalRoutes);
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

async function createBroadcasterWithProposal(status = 'draft') {
  const { user: broadcaster, auth } = await createBroadcaster();

  const product = await Product.create({
    broadcasterId: broadcaster._id,
    spotType: 'Comercial 30s',
    duration: 30,
    timeSlot: 'Manhã',
    netPrice: 80,
    pricePerInsertion: 100,
    isActive: true,
  });

  const proposal = await Proposal.create({
    broadcasterId: broadcaster._id,
    ownerType: 'broadcaster',
    title: 'Proposta da Emissora',
    proposalNumber: 'BPROP-001',
    slug: 'bproposta-001',
    status,
    items: [
      {
        productId: product._id.toString(),
        productName: 'Comercial 30s',
        broadcasterName: 'Rádio Teste',
        broadcasterId: broadcaster._id.toString(),
        quantity: 5,
        unitPrice: 100,
        totalPrice: 500,
        isCustom: false,
      },
    ],
    grossAmount: 500,
    totalAmount: 500,
    customization: { primaryColor: '#000', secondaryColor: '#fff', layout: 'classic' },
    comments: [],
    statusHistory: [],
    viewSessions: [],
  });

  return { broadcaster, auth, product, proposal };
}

// ─── uploadProposalImage ─────────────────────────────────────────────────

describe('POST /api/broadcaster-proposals/:id/upload', () => {
  it('faz upload de logo da proposta', async () => {
    const { auth, proposal } = await createBroadcasterWithProposal();

    const res = await request(app)
      .post(`/api/broadcaster-proposals/${proposal._id}/upload?type=logo`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .attach('file', Buffer.from('fake-image'), { filename: 'logo.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body.url).toBeDefined();
  });

  it('faz upload de cover da proposta', async () => {
    const { auth, proposal } = await createBroadcasterWithProposal();

    const res = await request(app)
      .post(`/api/broadcaster-proposals/${proposal._id}/upload?type=cover`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .attach('file', Buffer.from('fake-image'), { filename: 'cover.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body.url).toBeDefined();
  });

  it('retorna 400 sem arquivo', async () => {
    const { auth, proposal } = await createBroadcasterWithProposal();

    const res = await request(app)
      .post(`/api/broadcaster-proposals/${proposal._id}/upload?type=logo`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/arquivo/i);
  });

  it('retorna 400 para type invalido', async () => {
    const { auth, proposal } = await createBroadcasterWithProposal();

    const res = await request(app)
      .post(`/api/broadcaster-proposals/${proposal._id}/upload?type=banner`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .attach('file', Buffer.from('data'), { filename: 'img.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/logo.*cover|tipo/i);
  });

  it('retorna 404 para proposta inexistente', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/broadcaster-proposals/507f1f77bcf86cd799439011/upload?type=logo')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .attach('file', Buffer.from('data'), { filename: 'img.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(404);
  });

  it('retorna 403 para agency', async () => {
    const { auth: agencyAuth } = await createAgency();

    const res = await request(app)
      .post('/api/broadcaster-proposals/507f1f77bcf86cd799439011/upload?type=logo')
      .set('Cookie', agencyAuth.cookieHeader)
      .set('X-CSRF-Token', agencyAuth.csrfHeader)
      .attach('file', Buffer.from('data'), { filename: 'img.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(403);
  });

  it('retorna 401 sem autenticacao', async () => {
    const res = await request(app)
      .post('/api/broadcaster-proposals/507f1f77bcf86cd799439011/upload?type=logo')
      .attach('file', Buffer.from('data'), { filename: 'img.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(401);
  });
});

// ─── exportProposalXlsx ───────────────────────────────────────────────────

describe('GET /api/broadcaster-proposals/:id/export', () => {
  it('exporta proposta como xlsx', async () => {
    const { auth, proposal } = await createBroadcasterWithProposal('sent');

    const res = await request(app)
      .get(`/api/broadcaster-proposals/${proposal._id}/export`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheet|octet-stream/i);
  });

  it('retorna 403 para agency', async () => {
    const { auth: agencyAuth } = await createAgency();

    const res = await request(app)
      .get('/api/broadcaster-proposals/507f1f77bcf86cd799439011/export')
      .set('Cookie', agencyAuth.cookieHeader)
      .set('X-CSRF-Token', agencyAuth.csrfHeader);

    expect(res.status).toBe(403);
  });

  it('retorna 404 para proposta inexistente', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .get('/api/broadcaster-proposals/507f1f77bcf86cd799439011/export')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(404);
  });
});

// ─── uploadBroadcasterClientLogo ─────────────────────────────────────────

describe('POST /api/broadcaster-proposals/clients/:id/logo', () => {
  it('faz upload de logo do cliente', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();

    const client = await AgencyClient.create({
      broadcasterId: broadcaster._id,
      name: 'Cliente Teste',
      documentNumber: '12345678901234',
      contactEmail: 'cliente@teste.com',
    });

    const res = await request(app)
      .post(`/api/broadcaster-proposals/clients/${client._id}/logo`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .attach('file', Buffer.from('logo-data'), { filename: 'logo.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(res.body.logo).toBeDefined();
    expect(res.body.client).toBeDefined();
  });

  it('retorna 400 sem arquivo', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();

    const client = await AgencyClient.create({
      broadcasterId: broadcaster._id,
      name: 'Cliente Sem Logo',
      documentNumber: '12345678901235',
      contactEmail: 'semlogo@teste.com',
    });

    const res = await request(app)
      .post(`/api/broadcaster-proposals/clients/${client._id}/logo`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/arquivo|logo/i);
  });

  it('retorna 404 para cliente inexistente', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/broadcaster-proposals/clients/507f1f77bcf86cd799439011/logo')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .attach('file', Buffer.from('data'), { filename: 'logo.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(404);
  });

  it('retorna 403 para agency', async () => {
    const { auth: agencyAuth } = await createAgency();

    const res = await request(app)
      .post('/api/broadcaster-proposals/clients/507f1f77bcf86cd799439011/logo')
      .set('Cookie', agencyAuth.cookieHeader)
      .set('X-CSRF-Token', agencyAuth.csrfHeader)
      .attach('file', Buffer.from('data'), { filename: 'logo.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(403);
  });
});

// ─── restoreVersion ───────────────────────────────────────────────────────

describe('POST /api/broadcaster-proposals/:id/versions/:versionId/restore', () => {
  it('restaura proposta a partir de versao anterior', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();

    const proposal = await Proposal.create({
      broadcasterId: broadcaster._id,
      ownerType: 'broadcaster',
      title: 'Título Atual',
      proposalNumber: 'BPROP-VER-001',
      slug: 'bproposta-versao-001',
      status: 'draft',
      items: [],
      grossAmount: 500,
      totalAmount: 500,
      customization: { primaryColor: '#000', secondaryColor: '#fff', layout: 'classic' },
      comments: [],
      statusHistory: [],
      viewSessions: [],
    });

    const version = await ProposalVersion.create({
      proposalId: proposal._id,
      version: 1,
      snapshot: {
        title: 'Título da Versão Anterior',
        items: [],
        grossAmount: 200,
        totalAmount: 200,
        customization: { primaryColor: '#111', secondaryColor: '#eee', layout: 'modern' },
      },
      changedBy: broadcaster._id,
      changeType: 'manual',
    });

    const res = await request(app)
      .post(`/api/broadcaster-proposals/${proposal._id}/versions/${version._id}/restore`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.proposal.title).toBe('Título da Versão Anterior');
    expect(res.body.proposal.grossAmount).toBe(200);
  });

  it('retorna 404 para versao inexistente', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();

    const proposal = await Proposal.create({
      broadcasterId: broadcaster._id,
      ownerType: 'broadcaster',
      title: 'Proposta',
      proposalNumber: 'BPROP-VER-002',
      slug: 'bproposta-versao-002',
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
      .post(`/api/broadcaster-proposals/${proposal._id}/versions/507f1f77bcf86cd799439011/restore`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(404);
  });

  it('retorna 403 para advertiser', async () => {
    const { auth: advertiserAuth } = await createAdvertiser();

    const res = await request(app)
      .post('/api/broadcaster-proposals/507f1f77bcf86cd799439011/versions/507f1f77bcf86cd799439011/restore')
      .set('Cookie', advertiserAuth.cookieHeader)
      .set('X-CSRF-Token', advertiserAuth.csrfHeader);

    expect(res.status).toBe(403);
  });
});

// ─── setProtection ────────────────────────────────────────────────────────

describe('POST /api/broadcaster-proposals/:id/protection', () => {
  it('habilita protecao com PIN na proposta', async () => {
    const { auth, proposal } = await createBroadcasterWithProposal();

    const res = await request(app)
      .post(`/api/broadcaster-proposals/${proposal._id}/protection`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ enabled: true, pin: '5678' });

    expect(res.status).toBe(200);
    expect(res.body.protection).toBeDefined();
    expect(res.body.protection.enabled).toBe(true);
  });

  it('desabilita protecao da proposta', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();

    const proposal = await Proposal.create({
      broadcasterId: broadcaster._id,
      ownerType: 'broadcaster',
      title: 'Protegida',
      proposalNumber: 'BPROP-PROT-001',
      slug: 'bproposta-prot-001',
      status: 'draft',
      items: [],
      grossAmount: 0,
      totalAmount: 0,
      protection: { enabled: true, pin: '1111' },
      customization: { primaryColor: '#000', secondaryColor: '#fff', layout: 'classic' },
      comments: [],
      statusHistory: [],
      viewSessions: [],
    });

    const res = await request(app)
      .post(`/api/broadcaster-proposals/${proposal._id}/protection`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ enabled: false });

    expect(res.status).toBe(200);
  });

  it('retorna 404 para proposta inexistente', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/broadcaster-proposals/507f1f77bcf86cd799439011/protection')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ enabled: true, pin: '1234' });

    expect(res.status).toBe(404);
  });

  it('retorna 403 para agency', async () => {
    const { auth: agencyAuth } = await createAgency();

    const res = await request(app)
      .post('/api/broadcaster-proposals/507f1f77bcf86cd799439011/protection')
      .set('Cookie', agencyAuth.cookieHeader)
      .set('X-CSRF-Token', agencyAuth.csrfHeader)
      .send({ enabled: true, pin: '1234' });

    expect(res.status).toBe(403);
  });

  it('retorna 401 sem autenticacao', async () => {
    const res = await request(app)
      .post('/api/broadcaster-proposals/507f1f77bcf86cd799439011/protection')
      .send({ enabled: true });

    expect(res.status).toBe(401);
  });
});
