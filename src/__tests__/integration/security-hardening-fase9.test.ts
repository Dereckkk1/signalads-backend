/**
 * Integration Tests — FASE 9 (deteccao e resposta)
 *
 * 9.1 auditoria de respostas 4xx sensiveis (tentativa negada deixa rastro)
 * 9.2 auditLog nas rotas descobertas (block/unblock, catalogo-produtos, logo,
 *     reactivate/complete-profile e leitura de PII)
 * 9.3 filterSensitiveFields recursivo
 * 9.4 AuditLog tamper-evident (HMAC por registro)
 * 9.7 /api/test-reports fora do bundle de producao
 */

import '../helpers/mocks';

import request from 'supertest';
import express, { Application } from 'express';
import mongoose from 'mongoose';

import { createTestApp } from '../helpers/createTestApp';
import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { createAdmin, createAdvertiser } from '../helpers/authHelper';
import AuditLog, { verifyAuditLogIntegrity } from '../../models/AuditLog';
import testReportRoutes from '../../routes/testReportRoutes';

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

/** Audit logs sao gravados fire-and-forget; da um tick para a escrita concluir. */
async function flushAuditWrites() {
  await new Promise((resolve) => setTimeout(resolve, 60));
}

async function findLog(action: string) {
  await flushAuditWrites();
  return AuditLog.findOne({ action }).lean();
}

// ═══════════════════════════════════════════════════════════════
// 9.2 — leitura de PII gera trilha
// ═══════════════════════════════════════════════════════════════
describe('9.2 — GET /api/admin/users/:userId (leitura de PII)', () => {
  it('deve registrar user.pii_read quando admin abre o perfil completo', async () => {
    const { auth } = await createAdmin();
    const { user: alvo } = await createAdvertiser();

    const res = await request(app)
      .get(`/api/admin/users/${alvo._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);

    const log = await findLog('user.pii_read');
    expect(log).toBeTruthy();
    expect(log!.resource).toBe('user');
    expect(log!.resourceId).toBe(String(alvo._id));
  });

  it('deve registrar user.pii_read.denied em 404 (enumeracao de IDs)', async () => {
    const { auth } = await createAdmin();
    const inexistente = new mongoose.Types.ObjectId().toString();

    const res = await request(app)
      .get(`/api/admin/users/${inexistente}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(404);

    const log = await findLog('user.pii_read.denied');
    expect(log).toBeTruthy();
    expect(log!.details!.outcome).toBe('denied');
    expect(log!.details!.responseStatus).toBe(404);
    expect(log!.resourceId).toBe(inexistente);
  });
});

// ═══════════════════════════════════════════════════════════════
// 9.1 — 4xx sensiveis
// ═══════════════════════════════════════════════════════════════
describe('9.1 — auditoria de respostas 4xx sensiveis', () => {
  it('deve registrar .denied quando nao-admin tenta mudar role de usuario (403)', async () => {
    const { user: intruso, auth } = await createAdvertiser();
    const { user: alvo } = await createAdmin();

    const res = await request(app)
      .put(`/api/admin/users/${alvo._id}/role`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ role: 'admin' });

    expect(res.status).toBe(403);

    const log = await findLog('user.role_change.denied');
    expect(log).toBeTruthy();
    expect(String(log!.userId)).toBe(String(intruso._id));
    expect(log!.details!.responseStatus).toBe(403);
  });

  it('NAO deve registrar nada quando a requisicao e anonima (401 antes do middleware)', async () => {
    const { user: alvo } = await createAdmin();

    const res = await request(app).get(`/api/admin/users/${alvo._id}`);

    expect(res.status).toBe(401);

    await flushAuditWrites();
    expect(await AuditLog.countDocuments({})).toBe(0);
  });

  it('NAO deve registrar 400 de validacao (ruido)', async () => {
    const { auth } = await createAdmin();
    const { user: alvo } = await createAdvertiser();

    const res = await request(app)
      .put(`/api/admin/users/${alvo._id}/status`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ status: 'status-invalido' });

    expect(res.status).toBe(400);

    await flushAuditWrites();
    expect(await AuditLog.countDocuments({ action: /user\.status_change/ })).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 9.2 — block/unblock de usuario
// ═══════════════════════════════════════════════════════════════
describe('9.2 — bloqueio de usuario gera trilha', () => {
  it('deve registrar security.block_user', async () => {
    const { auth } = await createAdmin();
    const { user: alvo } = await createAdvertiser();

    const res = await request(app)
      .post(`/api/admin/monitoring/block-user/${alvo._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({});

    expect(res.status).toBe(200);

    const log = await findLog('security.block_user');
    expect(log).toBeTruthy();
    expect(log!.resourceId).toBe(String(alvo._id));
  });

  it('deve registrar security.block_ip com o IP no corpo redigido apenas onde sensivel', async () => {
    const { auth } = await createAdmin();

    await request(app)
      .post('/api/admin/monitoring/block-ip')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ ip: '203.0.113.77', reason: 'abuso' });

    const log = await findLog('security.block_ip');
    expect(log).toBeTruthy();
    expect(log!.details!.requestBody.ip).toBe('203.0.113.77');
  });
});

// ═══════════════════════════════════════════════════════════════
// 9.3 — redacao recursiva no que e efetivamente gravado
// ═══════════════════════════════════════════════════════════════
describe('9.3 — campos sensiveis redigidos em profundidade', () => {
  it('deve redigir senha aninhada e cpfOrCnpj no requestBody gravado', async () => {
    const { auth } = await createAdmin();
    const { user: alvo } = await createAdvertiser();

    await request(app)
      .put(`/api/admin/users/${alvo._id}/status`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        status: 'approved',
        cpfOrCnpj: '123.456.789-00',
        meta: { nivel2: { nivel3: { password: 'segredo', nome: 'visivel' } } },
      });

    const log = await findLog('user.status_change');
    expect(log).toBeTruthy();
    const body = log!.details!.requestBody;
    expect(body.cpfOrCnpj).toBe('[REDACTED]');
    expect(body.meta.nivel2.nivel3.password).toBe('[REDACTED]');
    expect(body.meta.nivel2.nivel3.nome).toBe('visivel');
    expect(body.status).toBe('approved');
  });
});

// ═══════════════════════════════════════════════════════════════
// 9.4 — tamper evidence
// ═══════════════════════════════════════════════════════════════
describe('9.4 — AuditLog tamper-evident', () => {
  it('deve assinar o registro gravado e validar a integridade', async () => {
    const { auth } = await createAdmin();
    const { user: alvo } = await createAdvertiser();

    await request(app)
      .get(`/api/admin/users/${alvo._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    const log = await findLog('user.pii_read');
    expect(log!.integrityHash).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyAuditLogIntegrity(log!)).toEqual({ valid: true });
  });

  it('deve detectar adulteracao feita direto no banco', async () => {
    const { auth } = await createAdmin();
    const { user: alvo } = await createAdvertiser();

    await request(app)
      .get(`/api/admin/users/${alvo._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    await flushAuditWrites();

    // Simula um atacante com acesso ao Mongo reescrevendo o IP de origem
    await AuditLog.collection.updateOne(
      { action: 'user.pii_read' },
      { $set: { ipAddress: '127.0.0.1' } }
    );

    const adulterado = await AuditLog.findOne({ action: 'user.pii_read' }).lean();
    expect(verifyAuditLogIntegrity(adulterado!)).toEqual({ valid: false, reason: 'tampered' });
  });
});

// ═══════════════════════════════════════════════════════════════
// 9.7 — test-reports fora de producao
// ═══════════════════════════════════════════════════════════════
describe('9.7 — /api/test-reports nao responde em producao', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  function buildAppWithTestReports() {
    const localApp = express();
    localApp.use(express.json());
    localApp.use('/api/test-reports', testReportRoutes);
    return localApp;
  }

  it('deve responder 404 em NODE_ENV=production mesmo se registrado', async () => {
    process.env.NODE_ENV = 'production';
    const res = await request(buildAppWithTestReports()).get('/api/test-reports/summary');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  it('fora de producao a rota continua existindo (exige auth de admin)', async () => {
    process.env.NODE_ENV = 'test';
    const res = await request(buildAppWithTestReports()).get('/api/test-reports/summary');
    expect(res.status).not.toBe(404);
    expect([401, 403]).toContain(res.status);
  });
});
