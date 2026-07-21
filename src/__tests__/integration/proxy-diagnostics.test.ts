/**
 * Integration Tests — GET /api/admin/monitoring/proxy-diagnostics
 *
 * Ferramenta de diagnostico do item 10.1 do plano de seguranca: determina,
 * a partir de um request real, quantos proxies existem na frente do Node.
 * `trust proxy` menor que o numero real de saltos torna `req.ip` spoofavel,
 * e com ele o rate limit por IP e a blocklist.
 */

import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';

import { createTestApp } from '../helpers/createTestApp';
import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { createAdmin, createAdvertiser } from '../helpers/authHelper';

let app: Application;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret-key-for-testing-12345';
  process.env.NODE_ENV = 'test';
  await connectTestDB();
  app = createTestApp();
});

afterEach(async () => {
  await clearTestDB();
});

afterAll(async () => {
  await disconnectTestDB();
});

const ROTA = '/api/admin/monitoring/proxy-diagnostics';

describe('proxy-diagnostics — controle de acesso', () => {
  it('exige autenticacao', async () => {
    const res = await request(app).get(ROTA);
    expect([401, 403]).toContain(res.status);
  });

  it('SEGURANCA: nao-admin recebe 403', async () => {
    const { auth } = await createAdvertiser();
    const res = await request(app)
      .get(ROTA)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });
});

describe('proxy-diagnostics — deteccao de saltos', () => {
  async function comoAdmin(headers: Record<string, string> = {}) {
    const { auth } = await createAdmin();
    const req = request(app)
      .get(ROTA)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);
    Object.entries(headers).forEach(([k, v]) => req.set(k, v));
    return req;
  }

  it('sem X-Forwarded-For, reporta zero saltos', async () => {
    const res = await comoAdmin();

    expect(res.status).toBe(200);
    expect(res.body.observado.hopsObservados).toBe(0);
    expect(res.body.veredito).toMatch(/sem proxy/i);
  });

  it('conta corretamente 1 salto', async () => {
    const res = await comoAdmin({ 'X-Forwarded-For': '203.0.113.10' });

    expect(res.body.observado.hopsObservados).toBe(1);
    expect(res.body.observado.xForwardedFor).toEqual(['203.0.113.10']);
  });

  it('conta corretamente 2 saltos (o cenario que preocupa)', async () => {
    const res = await comoAdmin({ 'X-Forwarded-For': '203.0.113.10, 198.51.100.7' });

    expect(res.body.observado.hopsObservados).toBe(2);
    expect(res.body.acao).toMatch(/CORRIGIR/);
  });

  it('detecta Cloudflare pelo CF-Connecting-IP', async () => {
    const res = await comoAdmin({
      'X-Forwarded-For': '203.0.113.10, 198.51.100.7',
      'CF-Connecting-IP': '203.0.113.10',
    });

    expect(res.body.veredito).toMatch(/Cloudflare/i);
    expect(res.body.observado.cfConnectingIp).toBe('203.0.113.10');
    expect(res.body.acao).toMatch(/CF-Connecting-IP/);
  });

  it('1 salto sem Cloudflare valida a configuracao atual', async () => {
    const res = await comoAdmin({ 'X-Forwarded-For': '203.0.113.10' });
    expect(res.body.acao).toMatch(/CORRETO/i);
  });

  it('devolve a configuracao atual de trust proxy para comparacao', async () => {
    const res = await comoAdmin();
    expect(res.body.configuracaoAtual).toHaveProperty('trustProxy');
    expect(res.body.comoInterpretar).toBeTruthy();
  });
});
