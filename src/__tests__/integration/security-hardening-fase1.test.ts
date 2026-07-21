/**
 * Integration Tests — Endurecimento de seguranca, Fase 1
 *
 * Regressao das correcoes do plano `docs/security-remediation-plan-2026-07-20.md`:
 *  - 1.1 webhook Asaas nao vaza WEBHOOK_AUTH_TOKEN em log; comparacao em tempo constante
 *  - 1.2 nome de grupo com metacaractere de regex nao quebra nem subverte o filtro
 *  - 1.4 authenticateToken roda ANTES do checkoutLimiter
 */

import '../helpers/mocks';

import request from 'supertest';
import express, { Application } from 'express';
import cookieParser from 'cookie-parser';

import { mongoSanitize, xssSanitize, dedupeQuery } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';
import paymentRoutes from '../../routes/paymentRoutes';
import broadcasterGroupRoutes from '../../routes/broadcasterGroupRoutes';

import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { createBroadcaster } from '../helpers/authHelper';
import BroadcasterGroup from '../../models/BroadcasterGroup';

const WEBHOOK_TOKEN = 'token-secreto-do-webhook-nao-pode-vazar';

function createTestApp(): Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(mongoSanitize);
  app.use(xssSanitize);
  app.use(dedupeQuery);
  app.use(csrfProtection);
  app.use('/api/payment', paymentRoutes);
  app.use('/api/broadcaster', broadcasterGroupRoutes);
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
  process.env.WEBHOOK_AUTH_TOKEN = WEBHOOK_TOKEN;
  await connectTestDB();
  app = createTestApp();
});

afterEach(async () => {
  await clearTestDB();
  jest.restoreAllMocks();
});

afterAll(async () => {
  await disconnectTestDB();
});

// ─────────────────────────────────────────────────────────────
// 1.1 — Webhook Asaas nao pode imprimir o segredo em log
// ─────────────────────────────────────────────────────────────
describe('1.1 — asaasWebhook nao vaza WEBHOOK_AUTH_TOKEN', () => {
  /** Captura tudo que foi escrito em console.warn/log/error durante o teste. */
  function captureConsole() {
    const lines: string[] = [];
    const sink = (...args: any[]) => { lines.push(args.map(String).join(' ')); };
    jest.spyOn(console, 'warn').mockImplementation(sink);
    jest.spyOn(console, 'log').mockImplementation(sink);
    jest.spyOn(console, 'error').mockImplementation(sink);
    return lines;
  }

  it('SEGURANCA: 401 com token errado nao imprime o token esperado', async () => {
    const logs = captureConsole();

    const res = await request(app)
      .post('/api/payment/asaas-webhook')
      .set('asaas-access-token', 'token-errado')
      .send({ event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_x' } });

    expect(res.status).toBe(401);
    const output = logs.join('\n');
    expect(output).not.toContain(WEBHOOK_TOKEN);
  });

  it('SEGURANCA: 401 sem header algum nao imprime o token esperado', async () => {
    const logs = captureConsole();

    const res = await request(app)
      .post('/api/payment/asaas-webhook')
      .send({ event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_x' } });

    expect(res.status).toBe(401);
    expect(logs.join('\n')).not.toContain(WEBHOOK_TOKEN);
  });

  it('SEGURANCA: payload invalido nao serializa o corpo (PII) no log', async () => {
    const logs = captureConsole();

    await request(app)
      .post('/api/payment/asaas-webhook')
      .set('asaas-access-token', WEBHOOK_TOKEN)
      .send({ payment: { customer: { cpfCnpj: '12345678900', email: 'vitima@teste.com' } } });

    const output = logs.join('\n');
    expect(output).not.toContain('12345678900');
    expect(output).not.toContain('vitima@teste.com');
  });

  it('rejeita token de tamanho diferente sem lancar (timingSafeEqual exige buffers iguais)', async () => {
    const res = await request(app)
      .post('/api/payment/asaas-webhook')
      .set('asaas-access-token', 'x')
      .send({ event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_x' } });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Token inválido');
  });

  it('aceita o token correto (nao quebrou o caminho feliz)', async () => {
    const res = await request(app)
      .post('/api/payment/asaas-webhook')
      .set('asaas-access-token', WEBHOOK_TOKEN)
      .send({ event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_inexistente' } });

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });

  it('SEGURANCA: token vazio nao passa quando WEBHOOK_AUTH_TOKEN esta ausente', async () => {
    const original = process.env.WEBHOOK_AUTH_TOKEN;
    delete process.env.WEBHOOK_AUTH_TOKEN;
    try {
      const res = await request(app)
        .post('/api/payment/asaas-webhook')
        .send({ event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_x' } });
      expect(res.status).toBe(401);
    } finally {
      process.env.WEBHOOK_AUTH_TOKEN = original;
    }
  });
});

// ─────────────────────────────────────────────────────────────
// 1.2 — Nome de grupo nao pode virar regex
// ─────────────────────────────────────────────────────────────
describe('1.2 — broadcasterGroups: nome nao e interpolado como regex', () => {
  /** Manager de emissora autenticado (cookies + header CSRF). */
  async function managerAuth() {
    const { auth } = await createBroadcaster();
    return auth;
  }

  it('SEGURANCA: ".*" nao casa grupos existentes (nao bloqueia a criacao)', async () => {
    const auth = await managerAuth();

    const first = await request(app)
      .post('/api/broadcaster/groups')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'Vendas', permissions: ['campaigns'] });
    expect(first.status).toBe(201);

    // Antes da correcao, `^.*$` casaria o grupo "Vendas" e devolveria
    // "Já existe um grupo com este nome", travando a criacao.
    const res = await request(app)
      .post('/api/broadcaster/groups')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: '.*', permissions: ['campaigns'] });

    expect(res.status).toBe(201);
    expect(res.body.group.name).toBe('.*');
  });

  it('SEGURANCA: regex invalida "(" nao gera 500', async () => {
    const auth = await managerAuth();

    const res = await request(app)
      .post('/api/broadcaster/groups')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: '(', permissions: ['campaigns'] });

    expect(res.status).toBe(201);
    expect(res.body.group.name).toBe('(');
  });

  it('SEGURANCA: padrao catastrofico nao e avaliado como regex', async () => {
    const auth = await managerAuth();

    const res = await request(app)
      .post('/api/broadcaster/groups')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: '(a+)+$', permissions: ['campaigns'] });

    expect(res.status).toBe(201);
  });

  it('duplicidade real continua sendo detectada (case-insensitive)', async () => {
    const auth = await managerAuth();

    await request(app)
      .post('/api/broadcaster/groups')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'Comercial', permissions: ['campaigns'] });

    const res = await request(app)
      .post('/api/broadcaster/groups')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'comercial', permissions: ['campaigns'] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Já existe um grupo com este nome');
  });

  it('rejeita nome nao-string (400, nao 500)', async () => {
    const auth = await managerAuth();

    const res = await request(app)
      .post('/api/broadcaster/groups')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 12345, permissions: ['campaigns'] });

    expect(res.status).toBe(400);
  });

  it('rejeita nome acima do limite de tamanho', async () => {
    const auth = await managerAuth();

    const res = await request(app)
      .post('/api/broadcaster/groups')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'a'.repeat(101), permissions: ['campaigns'] });

    expect(res.status).toBe(400);
  });

  it('updateGroup tambem escapa o nome', async () => {
    const auth = await managerAuth();

    const created = await request(app)
      .post('/api/broadcaster/groups')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'Time A', permissions: ['campaigns'] });
    expect(created.status).toBe(201);

    const res = await request(app)
      .put(`/api/broadcaster/groups/${created.body.group._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: '.*' });

    expect(res.status).toBe(200);
    const saved = await BroadcasterGroup.findById(created.body.group._id);
    expect(saved?.name).toBe('.*');
  });
});

// ─────────────────────────────────────────────────────────────
// 1.4 — Ordem dos middlewares no checkout
// ─────────────────────────────────────────────────────────────
describe('1.4 — checkout: authenticateToken antes do rate limiter', () => {
  it('authenticateToken precede checkoutLimiter na stack da rota', () => {
    const layer: any = (paymentRoutes as any).stack.find(
      (l: any) => l.route?.path === '/checkout' && l.route?.methods?.post
    );
    expect(layer).toBeDefined();

    const names: string[] = layer.route.stack.map((s: any) => s.name);
    const authIdx = names.findIndex((n) => n === 'authenticateToken');
    const limiterIdx = names.findIndex((n) => n !== 'authenticateToken' && n !== 'checkout');

    expect(authIdx).toBeGreaterThanOrEqual(0);
    expect(limiterIdx).toBeGreaterThanOrEqual(0);
    // Se o limiter vier primeiro, req.userId e undefined no keyGenerator
    // e a cota cai sempre no ramo por IP.
    expect(authIdx).toBeLessThan(limiterIdx);
  });
});
