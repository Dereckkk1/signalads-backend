/**
 * Integration Tests — rotateRefreshToken (tokenService.ts linhas 52-79)
 *
 * Arquivo separado para ter instância própria de app/rate-limiter.
 * Testa a rotação de refresh tokens via POST /api/auth/refresh:
 *   - Rotação bem-sucedida (linhas 60-79)
 *   - Token revogado → revogação de família (linha 52-54)
 *   - Token expirado → 401 (linha 58)
 */

import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';
import crypto from 'crypto';

import { createTestApp } from '../helpers/createTestApp';
import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { createTestUser, STRONG_PASSWORD } from '../helpers/authHelper';
import RefreshToken from '../../models/RefreshToken';

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

// ─── Helpers ────────────────────────────────────────────────────
async function loginAndGetRefreshToken(email: string): Promise<string> {
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ emailOrCnpj: email, password: STRONG_PASSWORD });

  const cookies = loginRes.headers['set-cookie'] as unknown as string[];
  const refreshCookie = cookies?.find((c: string) => c.startsWith('refresh_token='));
  const rawToken = refreshCookie?.split(';')[0]?.replace('refresh_token=', '') ?? '';
  return rawToken;
}

// ═══════════════════════════════════════════════════════════════
// POST /api/auth/refresh — rotação de refresh token
// ═══════════════════════════════════════════════════════════════
describe('POST /api/auth/refresh — rotação de token', () => {
  it('rotaciona token valido: gera novo access_token e refresh_token', async () => {
    await createTestUser({ email: 'rotation@empresa.com.br', password: STRONG_PASSWORD });
    const rawToken = await loginAndGetRefreshToken('rotation@empresa.com.br');
    expect(rawToken).toBeTruthy();

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', [`refresh_token=${rawToken}`]);

    expect(res.status).toBe(200);

    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.some((c: string) => c.startsWith('access_token='))).toBe(true);
    expect(cookies.some((c: string) => c.startsWith('refresh_token='))).toBe(true);
  });

  it('token valido gera novo refresh diferente do original', async () => {
    await createTestUser({ email: 'rotation2@empresa.com.br', password: STRONG_PASSWORD });
    const rawToken1 = await loginAndGetRefreshToken('rotation2@empresa.com.br');

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', [`refresh_token=${rawToken1}`]);

    expect(res.status).toBe(200);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const newRefreshCookie = cookies?.find((c: string) => c.startsWith('refresh_token='));
    const rawToken2 = newRefreshCookie?.split(';')[0]?.replace('refresh_token=', '');

    expect(rawToken2).toBeTruthy();
    expect(rawToken2).not.toBe(rawToken1);
  });

  it('token original revogado apos rotacao (token reuse detection)', async () => {
    await createTestUser({ email: 'rotation3@empresa.com.br', password: STRONG_PASSWORD });
    const rawToken = await loginAndGetRefreshToken('rotation3@empresa.com.br');

    // Primeira rotação — sucesso
    const res1 = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', [`refresh_token=${rawToken}`]);
    expect(res1.status).toBe(200);

    // Tenta reusar o token original (já revogado) — deve falhar
    const res2 = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', [`refresh_token=${rawToken}`]);
    expect(res2.status).toBe(401);
  });

  it('roubo detectado: reuso revoga toda a familia de tokens', async () => {
    await createTestUser({ email: 'theft@empresa.com.br', password: STRONG_PASSWORD });
    const rawToken = await loginAndGetRefreshToken('theft@empresa.com.br');

    // Rotação legítima
    const res1 = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', [`refresh_token=${rawToken}`]);
    expect(res1.status).toBe(200);

    // Atacante tenta usar o token antigo (revogado) → detecta roubo, revoga família
    await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', [`refresh_token=${rawToken}`]);

    // Verifica que TODOS os tokens da família foram revogados
    const hashedOriginal = crypto.createHash('sha256').update(rawToken).digest('hex');
    const originalToken = await RefreshToken.findOne({ token: hashedOriginal });
    expect(originalToken?.revokedAt).toBeDefined();

    // O novo token gerado também deve estar revogado
    const familyTokens = await RefreshToken.find({ family: originalToken?.family });
    const allRevoked = familyTokens.every(t => t.revokedAt);
    expect(allRevoked).toBe(true);
  });

  it('token expirado retorna 401', async () => {
    await createTestUser({ email: 'expired@empresa.com.br', password: STRONG_PASSWORD });
    const rawToken = await loginAndGetRefreshToken('expired@empresa.com.br');

    // Expirar o token diretamente no banco
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
    await RefreshToken.findOneAndUpdate(
      { token: hashedToken },
      { expiresAt: new Date(Date.now() - 1000) } // expirado
    );

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', [`refresh_token=${rawToken}`]);

    expect(res.status).toBe(401);
  });

  it('token inexistente no banco retorna 401', async () => {
    const fakeToken = crypto.randomBytes(40).toString('hex');

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', [`refresh_token=${fakeToken}`]);

    expect(res.status).toBe(401);
  });
});
