/**
 * Integration Tests — 2FA verify-code flow
 *
 * Separado de auth.test.ts para ter instância própria do rate limiter
 * (authLimiter tem max:25 por janela; compartilhar com auth.test causaria 429).
 */

import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';
import crypto from 'crypto';

import { createTestApp } from '../helpers/createTestApp';
import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { createAuthenticatedUser } from '../helpers/authHelper';
import { User } from '../../models/User';

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

// ─── Helper ────────────────────────────────────────────────────
async function createUserWith2FASession(code: string) {
  const codeHash = crypto.createHash('sha256').update(code).digest('hex');
  const sessionToken = crypto.randomBytes(32).toString('hex');
  const { user, auth } = await createAuthenticatedUser();
  await User.findByIdAndUpdate(user._id, {
    twoFactorEnabled: true,
    twoFactorConfirmedAt: new Date(),
    twoFactorCode: codeHash,
    twoFactorCodeExpires: new Date(Date.now() + 10 * 60 * 1000),
    twoFactorSessionToken: sessionToken,
    twoFactorAttempts: 0,
  });
  return { user, auth, sessionToken, code };
}

// ═══════════════════════════════════════════════════════════════
// POST /api/auth/2fa/verify-code
// ═══════════════════════════════════════════════════════════════
describe('POST /api/auth/2fa/verify-code', () => {
  it('finaliza login com codigo correto e seta cookies JWT', async () => {
    const code = '123456';
    const { sessionToken } = await createUserWith2FASession(code);

    const res = await request(app)
      .post('/api/auth/2fa/verify-code')
      .send({ userId: sessionToken, code });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/sucesso/i);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBeDefined();

    const cookies = res.headers['set-cookie'] as string[];
    expect(cookies.some((c: string) => c.startsWith('access_token='))).toBe(true);
    expect(cookies.some((c: string) => c.startsWith('csrf_token='))).toBe(true);
  });

  it('retorna 400 para codigo errado', async () => {
    const { sessionToken } = await createUserWith2FASession('123456');

    const res = await request(app)
      .post('/api/auth/2fa/verify-code')
      .send({ userId: sessionToken, code: '999999' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/inválido|expirado/i);
  });

  it('retorna 400 para session token inexistente', async () => {
    const res = await request(app)
      .post('/api/auth/2fa/verify-code')
      .send({ userId: 'session-token-inexistente-xpto', code: '123456' });

    expect(res.status).toBe(400);
  });

  it('retorna 400 para sessao expirada', async () => {
    const code = '654321';
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const { user } = await createAuthenticatedUser();
    await User.findByIdAndUpdate(user._id, {
      twoFactorEnabled: true,
      twoFactorCode: codeHash,
      twoFactorCodeExpires: new Date(Date.now() - 1000),
      twoFactorSessionToken: sessionToken,
      twoFactorAttempts: 0,
    });

    const res = await request(app)
      .post('/api/auth/2fa/verify-code')
      .send({ userId: sessionToken, code });

    expect(res.status).toBe(400);
  });

  it('bloqueia na 5a tentativa incorreta — sessionToken eh invalidado', async () => {
    const { user } = await createAuthenticatedUser();
    const code = '111111';
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    const sessionToken = crypto.randomBytes(32).toString('hex');
    await User.findByIdAndUpdate(user._id, {
      twoFactorEnabled: true,
      twoFactorCode: codeHash,
      twoFactorCodeExpires: new Date(Date.now() + 10 * 60 * 1000),
      twoFactorSessionToken: sessionToken,
      twoFactorAttempts: 4,
    });

    const res = await request(app)
      .post('/api/auth/2fa/verify-code')
      .send({ userId: sessionToken, code: '000000' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/muitas tentativas|inválido/i);

    const updated = await User.findById(user._id);
    expect(updated!.twoFactorSessionToken).toBeUndefined();
    expect(updated!.twoFactorAttempts).toBe(0);
  });

  it('limpa session token e codigo apos login bem sucedido', async () => {
    const code = '777777';
    const { user, sessionToken } = await createUserWith2FASession(code);

    await request(app)
      .post('/api/auth/2fa/verify-code')
      .send({ userId: sessionToken, code });

    const updated = await User.findById(user._id);
    expect(updated!.twoFactorSessionToken).toBeUndefined();
    expect(updated!.twoFactorCode).toBeUndefined();
    expect(updated!.twoFactorAttempts).toBe(0);
  });

  it('adiciona dispositivo confiavel quando trustDevice=true', async () => {
    const code = '888888';
    const { user, sessionToken } = await createUserWith2FASession(code);

    const res = await request(app)
      .post('/api/auth/2fa/verify-code')
      .send({ userId: sessionToken, code, trustDevice: true });

    expect(res.status).toBe(200);

    const updated = await User.findById(user._id);
    expect(updated!.trustedDevices?.length).toBeGreaterThan(0);
    expect(updated!.trustedDevices![0].deviceId).toBeDefined();
    expect(updated!.trustedDevices![0].deviceName).toBeDefined();
  });

  it('nao seta cookie de autenticacao antes de verificar codigo', async () => {
    const { sessionToken } = await createUserWith2FASession('555555');

    const res = await request(app)
      .post('/api/auth/2fa/verify-code')
      .send({ userId: sessionToken, code: '000000' }); // codigo errado

    expect(res.status).toBe(400);
    const cookies = res.headers['set-cookie'] as string[] | undefined;
    const hasAccessToken = cookies?.some((c: string) => c.startsWith('access_token='));
    expect(hasAccessToken).toBeFalsy();
  });
});
