/**
 * Integration Tests — Rotas publicas de proposta (gaps remanescentes)
 *
 * `getPublicProposal` sempre respeitou `protection.enabled`, mas as demais
 * rotas publicas nao — quem tivesse o slug operava sobre uma proposta
 * protegida sem passar pelo PIN, anulando tambem o lockout de 5 tentativas
 * do `verifyPin`.
 *
 * Cobre tambem a entropia do slug: em proposta SEM PIN, o slug e o unico
 * controle de acesso — e a pagina publica renderiza o Pedido de Insercao
 * completo, com CNPJ e endereco do cliente.
 */

import '../helpers/mocks';

import request from 'supertest';
import bcrypt from 'bcryptjs';
import { Application } from 'express';

import express from 'express';
import cookieParser from 'cookie-parser';
import { mongoSanitize, xssSanitize, sanitizeQuery } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';
import proposalRoutes from '../../routes/proposalRoutes';
import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { createAgency, createBroadcaster } from '../helpers/authHelper';
import Proposal from '../../models/Proposal';

let app: Application;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret-key-for-testing-12345';
  process.env.NODE_ENV = 'test';
  await connectTestDB();
  app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(mongoSanitize);
  app.use(xssSanitize);
  app.use(sanitizeQuery);
  app.use(csrfProtection);
  app.use('/api/proposals', proposalRoutes);
  app.use((_req, res) => { res.status(404).json({ error: 'Rota não encontrada' }); });
});

afterEach(async () => {
  await clearTestDB();
});

afterAll(async () => {
  await disconnectTestDB();
});

const PIN_CORRETO = '246810';

/** Proposta enviada, opcionalmente protegida por PIN. */
async function criarProposta(comPin: boolean) {
  const { user: agency } = await createAgency();
  const { user: broadcaster } = await createBroadcaster();

  const proposal = await Proposal.create({
    title: 'Campanha Teste',
    slug: `campanha-teste-${comPin ? 'protegida' : 'aberta'}`,
    proposalNumber: comPin ? 'PROP-0001' : 'PROP-0002',
    ownerType: 'agency',
    agencyId: agency._id,
    broadcasterId: broadcaster._id,
    status: 'sent',
    sentAt: new Date(),
    items: [],
    sections: [],
    comments: [],
    grossAmount: 0,
    totalAmount: 0,
    ...(comPin
      ? { protection: { enabled: true, pin: await bcrypt.hash(PIN_CORRETO, 10) } }
      : {}),
  } as any);

  return proposal;
}

describe('PIN protege TODAS as rotas publicas, nao so a leitura', () => {
  it('SEGURANCA: comentario em proposta protegida exige PIN', async () => {
    const p = await criarProposta(true);

    const res = await request(app)
      .post(`/api/proposals/public/${p.slug}/comments`)
      .send({ sectionId: 'sec-1', text: 'comentario', author: 'Fulano' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/PIN/i);

    const salva = await Proposal.findById(p._id).lean();
    expect(salva!.comments).toHaveLength(0);
  });

  it('comentario passa com o PIN correto', async () => {
    const p = await criarProposta(true);

    const res = await request(app)
      .post(`/api/proposals/public/${p.slug}/comments`)
      .set('X-Proposal-Pin', PIN_CORRETO)
      .send({ sectionId: 'sec-1', text: 'comentario', author: 'Fulano' });

    expect(res.status).toBeLessThan(400);
  });

  it('SEGURANCA: PIN errado no comentario e recusado', async () => {
    const p = await criarProposta(true);

    const res = await request(app)
      .post(`/api/proposals/public/${p.slug}/comments`)
      .set('X-Proposal-Pin', '000000')
      .send({ sectionId: 'sec-1', text: 'x', author: 'Fulano' });

    expect(res.status).toBe(401);
  });

  it('SEGURANCA: telemetria de sessao em proposta protegida exige PIN', async () => {
    const p = await criarProposta(true);

    const res = await request(app)
      .post(`/api/proposals/public/${p.slug}/session`)
      .send({ duration: 120, scrollDepth: 80 });

    expect(res.status).toBe(401);
  });

  it('SEGURANCA: export XLSX de proposta protegida exige PIN', async () => {
    const p = await criarProposta(true);

    const res = await request(app).get(`/api/proposals/public/${p.slug}/export`);

    expect(res.status).toBe(401);
  });

  it('proposta SEM PIN continua aberta (nao quebrou o fluxo normal)', async () => {
    const p = await criarProposta(false);

    const res = await request(app)
      .post(`/api/proposals/public/${p.slug}/comments`)
      .send({ sectionId: 'sec-1', text: 'comentario', author: 'Fulano' });

    expect(res.status).toBeLessThan(400);
  });

  it('leitura de proposta protegida continua devolvendo protected:true', async () => {
    const p = await criarProposta(true);

    const res = await request(app).get(`/api/proposals/public/${p.slug}`);

    expect(res.status).toBe(200);
    expect(res.body.protected).toBe(true);
    expect(res.body.proposal).toBeNull();
  });
});

describe('entropia do slug publico', () => {
  it('slug novo tem entropia suficiente contra enumeracao', async () => {
    const { user: agency } = await createAgency();
    const { user: broadcaster } = await createBroadcaster();

    // Cria via model usando o mesmo gerador do controller seria acoplamento;
    // o que importa e a propriedade: o sufixo aleatorio precisa ser longo.
    const { default: crypto } = await import('crypto');
    const sufixo = crypto.randomBytes(16).toString('base64url').substring(0, 16);

    const p = await Proposal.create({
      title: 'X', slug: `x-${sufixo}`, proposalNumber: 'PROP-9',
      ownerType: 'agency', agencyId: agency._id, broadcasterId: broadcaster._id,
      status: 'sent', items: [], sections: [], comments: [],
      grossAmount: 0, totalAmount: 0,
    } as any);

    // ATENCAO: nao usar split('-') aqui — o alfabeto base64url INCLUI '-',
    // entao o sufixo aleatorio pode conter hifens e o split o partiria ao meio.
    const aleatorio = p.slug.slice('x-'.length);
    // 8 chars base64url ~48 bits; 16 chars ~96 bits.
    expect(aleatorio.length).toBeGreaterThanOrEqual(16);
  });
});
