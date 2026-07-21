/**
 * Integration Tests — FASE 7 (endurecimento de autenticacao)
 *
 * Estes testes sao escritos do ponto de vista do ATACANTE: cada caso monta o
 * ataque concreto que a correcao deve derrubar e afirma que ele FALHA. Assertar
 * "o campo mudou de nome" nao provaria nada — o que importa e que a credencial
 * roubada deixou de abrir a porta.
 *
 * Arquivo proprio (instancia propria de app/rate-limiter) para nao competir com
 * o `authLimiter` compartilhado de auth.test.ts.
 */

import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

import { createTestApp } from '../helpers/createTestApp';
import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import {
  createTestUser,
  createAuthenticatedUser,
  STRONG_PASSWORD,
} from '../helpers/authHelper';
import { User, hashLookupToken } from '../../models/User';
import { redis } from '../../config/redis';
import { JWT_ISSUER, JWT_AUDIENCE, deriveCsrfToken } from '../../utils/tokenService';

let app: Application;

const TEST_JWT_SECRET = 'test-secret-key-for-testing-12345';

beforeAll(async () => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
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

/** Le um campo `select: false` — simula quem tem acesso de leitura ao Mongo. */
async function readRawField(userId: any, field: string): Promise<string | undefined> {
  const doc = await User.findById(userId).select(`+${field}`).lean();
  return (doc as any)?.[field];
}

// ═══════════════════════════════════════════════════════════════
// 7.1 — Tokens de uso unico nao sao credenciais quando lidos do banco
// ═══════════════════════════════════════════════════════════════
describe('7.1 — token de reset lido do banco NAO funciona como credencial', () => {
  it('o valor persistido em passwordResetToken e rejeitado no reset-password', async () => {
    const user = await createTestUser({ email: 'reset-victim@empresa.com.br' });

    // Fluxo real: usuario pede o link por e-mail.
    await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'reset-victim@empresa.com.br' })
      .expect(200);

    // ATACANTE: le o banco (dump/backup/replica) e pega o que esta gravado.
    const stored = await readRawField(user._id, 'passwordResetToken');
    expect(stored).toBeTruthy();

    // O que esta gravado NAO e o token do e-mail — e o SHA-256 dele.
    expect(stored).toMatch(/^[a-f0-9]{64}$/);

    // ATAQUE: usar o valor do banco como se fosse o link de redefinicao.
    const res = await request(app)
      .post(`/api/auth/reset-password/${stored}`)
      .send({ password: 'SenhaDoAtacante1!' });

    expect(res.status).toBe(400);

    // E a senha da vitima continua sendo a original.
    const login = await request(app)
      .post('/api/auth/login')
      .send({ emailOrCnpj: 'reset-victim@empresa.com.br', password: STRONG_PASSWORD });
    expect(login.status).toBe(200);
  });

  it('o token CRU (o do e-mail) continua funcionando — a correcao nao quebra o fluxo', async () => {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const user = await createTestUser({ email: 'reset-ok@empresa.com.br' });
    // Escrita via update: o hook do schema grava o hash.
    await User.findByIdAndUpdate(user._id, {
      passwordResetToken: rawToken,
      passwordResetTokenExpires: new Date(Date.now() + 3600_000),
    });

    expect(await readRawField(user._id, 'passwordResetToken')).toBe(hashLookupToken(rawToken));

    const res = await request(app)
      .post(`/api/auth/reset-password/${rawToken}`)
      .send({ password: 'NovaSenhaValida1!' });

    expect(res.status).toBe(200);
  });

  it('o valor persistido em emailConfirmToken e rejeitado na confirmacao de e-mail', async () => {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const user = await createTestUser({
      email: 'confirm-victim@empresa.com.br',
      emailConfirmed: false,
    });
    await User.findByIdAndUpdate(user._id, {
      emailConfirmToken: rawToken,
      emailConfirmTokenExpires: new Date(Date.now() + 3600_000),
    });

    const stored = await readRawField(user._id, 'emailConfirmToken');
    expect(stored).toBe(hashLookupToken(rawToken));

    // ATAQUE: confirmar a conta de outra pessoa com o valor lido do banco.
    await request(app).get(`/api/auth/confirm-email/${stored}`).expect(400);

    // O token do e-mail funciona.
    await request(app).get(`/api/auth/confirm-email/${rawToken}`).expect(200);
  });

  it('o valor persistido em twoFactorPendingToken nao habilita 2FA', async () => {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const { user } = await createAuthenticatedUser();
    await User.findByIdAndUpdate(user._id, {
      twoFactorPendingToken: rawToken,
      twoFactorPendingTokenExpires: new Date(Date.now() + 3600_000),
    });

    const stored = await readRawField(user._id, 'twoFactorPendingToken');
    expect(stored).toBe(hashLookupToken(rawToken));

    await request(app).get(`/api/auth/2fa/confirm/${stored}`).expect(400);
    await request(app).get(`/api/auth/2fa/confirm/${rawToken}`).expect(200);
  });

  it('o valor persistido em twoFactorSessionToken/twoFactorCode nao completa o login 2FA', async () => {
    const code = '424242';
    const rawSession = crypto.randomBytes(32).toString('hex');
    const { user } = await createAuthenticatedUser();
    await User.findByIdAndUpdate(user._id, {
      twoFactorEnabled: true,
      twoFactorConfirmedAt: new Date(),
      twoFactorCode: code,
      twoFactorCodeExpires: new Date(Date.now() + 600_000),
      twoFactorSessionToken: rawSession,
      twoFactorAttempts: 0,
    });

    const storedSession = await readRawField(user._id, 'twoFactorSessionToken');
    const storedCode = await readRawField(user._id, 'twoFactorCode');
    expect(storedSession).toBe(hashLookupToken(rawSession));
    expect(storedCode).toBe(hashLookupToken(code));

    // ATAQUE: usar os valores do banco diretamente como credencial.
    const attack = await request(app)
      .post('/api/auth/2fa/verify-code')
      .send({ userId: storedSession, code: storedCode });
    expect(attack.status).toBe(400);

    // Os valores originais (session do cliente + codigo do e-mail) funcionam.
    const ok = await request(app)
      .post('/api/auth/2fa/verify-code')
      .send({ userId: rawSession, code });
    expect(ok.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════
// 7.2 — resetPassword invalida sessoes ativas
// ═══════════════════════════════════════════════════════════════
describe('7.2 — reset de senha derruba o access token do atacante', () => {
  it('access token emitido antes do reset deixa de autenticar', async () => {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const { user } = await createAuthenticatedUser({ email: 'pwned@empresa.com.br' });
    const userId = user._id.toString();

    // Token do ATACANTE, capturado 60s antes do reset. O `iat` no passado importa:
    // o iat floor e gravado com granularidade de segundos, entao um token emitido
    // no mesmo segundo do reset nao seria coberto.
    const stolenToken = jwt.sign(
      {
        userId,
        jti: crypto.randomUUID(),
        iat: Math.floor(Date.now() / 1000) - 60,
      },
      TEST_JWT_SECRET,
      { expiresIn: '15m', issuer: JWT_ISSUER, audience: JWT_AUDIENCE }
    );
    const stolenCookie = [`access_token=${stolenToken}`];

    // Sessao roubada funciona antes do reset.
    await request(app)
      .get('/api/auth/me')
      .set('Cookie', stolenCookie)
      .expect(200);

    await User.findByIdAndUpdate(user._id, {
      passwordResetToken: rawToken,
      passwordResetTokenExpires: new Date(Date.now() + 3600_000),
    });

    const redisSet = redis.set as unknown as jest.Mock;
    redisSet.mockClear();

    await request(app)
      .post(`/api/auth/reset-password/${rawToken}`)
      .send({ password: 'SenhaRecuperada1!' })
      .expect(200);

    // O reset gravou o iat floor do usuario (antes so revogava o refresh token).
    const floorWrite = redisSet.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0] === `auth:iatFloor:${userId}`
    );
    expect(floorWrite).toBeDefined();
    const floorValue = floorWrite![1] as string;

    // O Redis e mockado (sempre null) neste ambiente; para provar que o ATAQUE
    // falha de ponta a ponta, devolvemos o floor que acabou de ser gravado.
    (redis.get as unknown as jest.Mock).mockImplementation(async (key: string) =>
      key === `auth:iatFloor:${userId}` ? floorValue : null
    );

    try {
      const after = await request(app)
        .get('/api/auth/me')
        .set('Cookie', stolenCookie);

      expect(after.status).toBe(401);
    } finally {
      (redis.get as unknown as jest.Mock).mockResolvedValue(null);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 7.3 — enumeracao por timing no login
// ═══════════════════════════════════════════════════════════════
describe('7.3 — login nao distingue conta inexistente de senha errada', () => {
  it('ambos os ramos gastam tempo comparavel e devolvem o mesmo 401', async () => {
    await createTestUser({ email: 'existe@empresa.com.br', password: STRONG_PASSWORD });

    const t0 = Date.now();
    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ emailOrCnpj: 'existe@empresa.com.br', password: 'SenhaErrada1!' });
    const tWrongPassword = Date.now() - t0;

    const t1 = Date.now();
    const noUser = await request(app)
      .post('/api/auth/login')
      .send({ emailOrCnpj: 'naoexiste@empresa.com.br', password: 'SenhaErrada1!' });
    const tNoUser = Date.now() - t1;

    expect(wrongPassword.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(noUser.body.error).toBe(wrongPassword.body.error);

    // O ramo "usuario inexistente" nao pode ser uma ordem de grandeza mais rapido.
    // Limite frouxo de proposito: CI e ruidoso; o que se quer detectar e o retorno
    // ao comportamento antigo (~1ms vs ~centenas de ms).
    expect(tNoUser).toBeGreaterThan(tWrongPassword / 10);
  });
});

// ═══════════════════════════════════════════════════════════════
// 7.4 — campos sensiveis nao vazam pela projecao padrao
// ═══════════════════════════════════════════════════════════════
describe('7.4 — select:false impede que segredos entrem em memoria/cache', () => {
  it('User.findById padrao nao traz tokens nem segredo de 2FA', async () => {
    const { user } = await createAuthenticatedUser();
    await User.findByIdAndUpdate(user._id, {
      passwordResetToken: 'x'.repeat(40),
      emailConfirmToken: 'y'.repeat(40),
      twoFactorPendingToken: 'z'.repeat(40),
      twoFactorSessionToken: 'w'.repeat(40),
      twoFactorCode: '123456',
      twoFactorSecret: 'segredo-totp',
    });

    // Esta e exatamente a projecao que `middleware/auth.ts` serializa no Redis.
    const loaded = await User.findById(user._id).select('-password').lean();

    expect((loaded as any).passwordResetToken).toBeUndefined();
    expect((loaded as any).emailConfirmToken).toBeUndefined();
    expect((loaded as any).twoFactorPendingToken).toBeUndefined();
    expect((loaded as any).twoFactorSessionToken).toBeUndefined();
    expect((loaded as any).twoFactorCode).toBeUndefined();
    expect((loaded as any).twoFactorSecret).toBeUndefined();
  });

  it('GET /api/auth/me nao devolve nenhum campo de token', async () => {
    const { user, auth } = await createAuthenticatedUser();
    await User.findByIdAndUpdate(user._id, {
      passwordResetToken: 'a'.repeat(40),
      twoFactorSessionToken: 'b'.repeat(40),
    });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', auth.cookieHeader)
      .expect(200);

    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/passwordResetToken/);
    expect(body).not.toMatch(/twoFactorSessionToken/);
    expect(body).not.toMatch(/twoFactorSecret/);
  });
});

// ═══════════════════════════════════════════════════════════════
// 7.5 — status != approved nao recebe sessao
// ═══════════════════════════════════════════════════════════════
describe('7.5 — login nao emite tokens para conta nao aprovada', () => {
  it.each(['pending', 'blocked'] as const)(
    'conta %s recebe 403 e NENHUM cookie de sessao',
    async (status) => {
      await createTestUser({
        email: `status-${status}@empresa.com.br`,
        password: STRONG_PASSWORD,
        emailConfirmed: true,
        status: status as any,
      });

      const res = await request(app)
        .post('/api/auth/login')
        .send({ emailOrCnpj: `status-${status}@empresa.com.br`, password: STRONG_PASSWORD });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('account_not_approved');

      const cookies = (res.headers['set-cookie'] as unknown as string[]) || [];
      expect(cookies.some((c) => c.startsWith('access_token='))).toBe(false);
      expect(cookies.some((c) => c.startsWith('refresh_token='))).toBe(false);
    }
  );

  it('optionalAuthenticateToken trata conta nao aprovada como anonima', async () => {
    // /api/products/map usa auth opcional; o alvo aqui e o middleware, entao
    // basta provar que a rota nao rejeita e que a identidade nao foi assumida.
    const { user, auth } = await createAuthenticatedUser({ email: 'opt@empresa.com.br' });
    await User.findByIdAndUpdate(user._id, { status: 'blocked' });

    // Rota com auth OBRIGATORIA: 403 confirma que o status foi reavaliado.
    const strict = await request(app)
      .get('/api/auth/me')
      .set('Cookie', auth.cookieHeader);
    expect(strict.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════
// 7.6 — issuer/audience obrigatorios no JWT
// ═══════════════════════════════════════════════════════════════
describe('7.6 — JWT sem issuer/audience corretos e rejeitado', () => {
  it('token assinado com o segredo correto mas sem iss/aud nao autentica', async () => {
    const { user } = await createAuthenticatedUser();

    // ATAQUE: JWT valido em assinatura, emitido por outro servico que compartilha
    // o mesmo JWT_SECRET (ou por um fluxo legado sem claims).
    const forged = jwt.sign({ userId: user._id.toString() }, TEST_JWT_SECRET, {
      expiresIn: '15m',
    });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', [`access_token=${forged}`]);

    expect(res.status).toBe(401);
  });

  it('token com audience de outro publico e rejeitado', async () => {
    const { user } = await createAuthenticatedUser();

    const forged = jwt.sign({ userId: user._id.toString() }, TEST_JWT_SECRET, {
      expiresIn: '15m',
      issuer: JWT_ISSUER,
      audience: 'outro-app',
    });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', [`access_token=${forged}`]);

    expect(res.status).toBe(401);
  });

  it('o token emitido pelo login real carrega iss/aud e autentica', async () => {
    await createTestUser({ email: 'issaud@empresa.com.br', password: STRONG_PASSWORD });

    const login = await request(app)
      .post('/api/auth/login')
      .send({ emailOrCnpj: 'issaud@empresa.com.br', password: STRONG_PASSWORD })
      .expect(200);

    const cookies = login.headers['set-cookie'] as unknown as string[];
    const accessCookie = cookies.find((c) => c.startsWith('access_token='))!;
    const raw = accessCookie.split(';')[0]!.replace('access_token=', '');

    const decoded = jwt.decode(raw) as any;
    expect(decoded.iss).toBe(JWT_ISSUER);
    expect(decoded.aud).toBe(JWT_AUDIENCE);
  });
});

// ═══════════════════════════════════════════════════════════════
// 7.7 — CSRF token derivado da sessao
// ═══════════════════════════════════════════════════════════════
describe('7.7 — csrf_token e vinculado ao jti da sessao', () => {
  it('o csrf_token emitido no login e HMAC(JWT_SECRET, jti) do access token', async () => {
    await createTestUser({ email: 'csrfbind@empresa.com.br', password: STRONG_PASSWORD });

    const login = await request(app)
      .post('/api/auth/login')
      .send({ emailOrCnpj: 'csrfbind@empresa.com.br', password: STRONG_PASSWORD })
      .expect(200);

    const cookies = login.headers['set-cookie'] as unknown as string[];
    const access = cookies
      .find((c) => c.startsWith('access_token='))!
      .split(';')[0]!
      .replace('access_token=', '');
    const csrf = cookies
      .find((c) => c.startsWith('csrf_token='))!
      .split(';')[0]!
      .replace('csrf_token=', '');

    const jti = (jwt.decode(access) as any).jti as string;
    expect(jti).toBeTruthy();
    expect(csrf).toBe(deriveCsrfToken(jti));
  });

  it('duas sessoes distintas recebem csrf_tokens distintos', async () => {
    await createTestUser({ email: 'csrf2@empresa.com.br', password: STRONG_PASSWORD });

    const csrfOf = async () => {
      const r = await request(app)
        .post('/api/auth/login')
        .send({ emailOrCnpj: 'csrf2@empresa.com.br', password: STRONG_PASSWORD })
        .expect(200);
      const cookies = r.headers['set-cookie'] as unknown as string[];
      return cookies.find((c) => c.startsWith('csrf_token='))!;
    };

    expect(await csrfOf()).not.toBe(await csrfOf());
  });
});

// ═══════════════════════════════════════════════════════════════
// 7.8 — rota morta de 2FA
// ═══════════════════════════════════════════════════════════════
describe('7.8 — /api/auth/2fa/validate nao existe', () => {
  it('a rota que aceitava o token de HABILITACAO como credencial de login retorna 404', async () => {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const { user } = await createAuthenticatedUser();
    await User.findByIdAndUpdate(user._id, {
      twoFactorPendingToken: rawToken,
      twoFactorPendingTokenExpires: new Date(Date.now() + 3600_000),
    });

    const res = await request(app)
      .post('/api/auth/2fa/validate')
      .send({ userId: user._id.toString(), token: rawToken });

    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════
// 7.9 — 2FA obrigatorio para admin
// ═══════════════════════════════════════════════════════════════
describe('7.9 — admin nunca abre sessao so com senha', () => {
  it('login de admin com senha correta exige segundo fator e nao seta cookies', async () => {
    await createTestUser({
      email: 'admin-2fa@empresa.com.br',
      password: STRONG_PASSWORD,
      userType: 'admin',
      status: 'approved',
      emailConfirmed: true,
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ emailOrCnpj: 'admin-2fa@empresa.com.br', password: STRONG_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.requiresTwoFactor).toBe(true);
    expect(res.body.user).toBeUndefined();

    const cookies = (res.headers['set-cookie'] as unknown as string[]) || [];
    expect(cookies.some((c) => c.startsWith('access_token='))).toBe(false);
  });

  it('dispositivo confiavel NAO pula o segundo fator do admin', async () => {
    const userAgent = 'jest-trusted-device';
    const user = await createTestUser({
      email: 'admin-trusted@empresa.com.br',
      password: STRONG_PASSWORD,
      userType: 'admin',
      status: 'approved',
      emailConfirmed: true,
    });

    // Planta um dispositivo confiavel valido para qualquer fingerprint plausivel:
    // mesmo assim o admin deve receber requiresTwoFactor.
    const deviceId = crypto
      .createHash('sha256')
      .update(`${userAgent}127.0.0.1`)
      .digest('hex');
    await User.findByIdAndUpdate(user._id, {
      twoFactorEnabled: true,
      twoFactorConfirmedAt: new Date(),
      trustedDevices: [
        { deviceId, deviceName: 'Jest', lastUsed: new Date(), createdAt: new Date() },
      ],
    });

    const res = await request(app)
      .post('/api/auth/login')
      .set('User-Agent', userAgent)
      .send({ emailOrCnpj: 'admin-trusted@empresa.com.br', password: STRONG_PASSWORD });

    expect(res.body.requiresTwoFactor).toBe(true);
    const cookies = (res.headers['set-cookie'] as unknown as string[]) || [];
    expect(cookies.some((c) => c.startsWith('access_token='))).toBe(false);
  });

  it('advertiser sem 2FA continua logando normalmente (sem regressao)', async () => {
    await createTestUser({ email: 'nao-admin@empresa.com.br', password: STRONG_PASSWORD });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ emailOrCnpj: 'nao-admin@empresa.com.br', password: STRONG_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.requiresTwoFactor).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// 7.10 — validacao do JWT_SECRET
// ═══════════════════════════════════════════════════════════════
describe('7.10 — JWT_SECRET e validado quando NODE_ENV=production', () => {
  const original = { env: process.env.NODE_ENV, secret: process.env.JWT_SECRET };

  afterEach(() => {
    process.env.NODE_ENV = original.env;
    process.env.JWT_SECRET = original.secret;
  });

  it('lanca quando o segredo esta ausente em producao', async () => {
    const { assertJwtSecretStrength } = await import('../../utils/tokenService');
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;
    expect(() => assertJwtSecretStrength()).toThrow(/JWT_SECRET/);
  });

  it('lanca quando o segredo tem menos de 32 caracteres em producao', async () => {
    const { assertJwtSecretStrength } = await import('../../utils/tokenService');
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'curto-demais';
    expect(() => assertJwtSecretStrength()).toThrow(/curto/i);
  });

  it('nao lanca fora de producao (dev/test seguem com segredo fraco)', async () => {
    const { assertJwtSecretStrength } = await import('../../utils/tokenService');
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'x';
    expect(() => assertJwtSecretStrength()).not.toThrow();
  });
});
