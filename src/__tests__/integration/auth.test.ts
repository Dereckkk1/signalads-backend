/**
 * Integration Tests — Authentication API
 *
 * Tests real HTTP endpoints end-to-end using supertest + mongodb-memory-server.
 * POST /api/auth/register, /login, /logout, /forgot-password, /refresh, /change-password
 * GET  /api/auth/me
 */

// Mocks MUST be first (jest.mock is hoisted)
import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

import { createTestApp } from '../helpers/createTestApp';
import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import {
  createTestUser,
  createAuthenticatedUser,
  STRONG_PASSWORD,
} from '../helpers/authHelper';
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

// ─────────────────────────────────────────────────
// POST /api/auth/register
// ─────────────────────────────────────────────────
describe('POST /api/auth/register', () => {
  it('should register an advertiser successfully', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'novo@empresa.com.br',
        password: STRONG_PASSWORD,
        userType: 'advertiser',
        companyName: 'Nova Empresa',
        fantasyName: 'Nova',
        phone: '11999999999',
        cpfOrCnpj: '12345678000100',
      });

    expect(res.status).toBe(201);
    expect(res.body.requiresEmailConfirmation).toBe(true);

    // Verify user was created in DB
    const user = await User.findOne({ email: 'novo@empresa.com.br' });
    expect(user).not.toBeNull();
    expect(user!.userType).toBe('advertiser');
    expect(user!.emailConfirmed).toBe(false);
  });

  it('should register an agency successfully', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'novo@agencia.com.br',
        password: STRONG_PASSWORD,
        userType: 'agency',
        companyName: 'Nova Agencia',
        phone: '11988888888',
        cpfOrCnpj: '98765432000199',
      });

    expect(res.status).toBe(201);
    expect(res.body.requiresEmailConfirmation).toBe(true);
  });

  it('should reject broadcaster self-registration', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'radio@emissora.com.br',
        password: STRONG_PASSWORD,
        userType: 'broadcaster',
        companyName: 'Radio Test',
        phone: '11977777777',
        cpfOrCnpj: '11222333000144',
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/auto-cadastro/i);
  });

  it('should reject admin self-registration', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'admin@empresa.com.br',
        password: STRONG_PASSWORD,
        userType: 'admin',
        companyName: 'Admin Corp',
        phone: '11966666666',
        cpfOrCnpj: '55444333000100',
      });

    expect(res.status).toBe(403);
  });

  it('should reject weak password', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'weak@empresa.com.br',
        password: 'short',
        userType: 'advertiser',
        companyName: 'Weak Co',
        phone: '11955555555',
        cpfOrCnpj: '00111222000100',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('should reject free email domains (gmail, hotmail)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'test@gmail.com',
        password: STRONG_PASSWORD,
        userType: 'advertiser',
        companyName: 'Gmail User',
        phone: '11944444444',
        cpfOrCnpj: '00222333000100',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/corporativo/i);
  });

  it('should return generic response for duplicate email (prevents enumeration)', async () => {
    // Create existing user first
    await createTestUser({ email: 'existe@empresa.com.br' });

    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'existe@empresa.com.br',
        password: STRONG_PASSWORD,
        userType: 'advertiser',
        companyName: 'Dup Co',
        phone: '11933333333',
        cpfOrCnpj: '00333444000100',
      });

    // Returns 200 with generic message to prevent account enumeration
    expect(res.status).toBe(200);
    expect(res.body.requiresEmailConfirmation).toBe(true);
  });
});

// ─────────────────────────────────────────────────
// POST /api/auth/login
// ─────────────────────────────────────────────────
describe('POST /api/auth/login', () => {
  it('should login successfully with correct credentials', async () => {
    await createTestUser({
      email: 'user@empresa.com.br',
      password: STRONG_PASSWORD,
      emailConfirmed: true,
      status: 'approved',
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ emailOrCnpj: 'user@empresa.com.br', password: STRONG_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/sucesso/i);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe('user@empresa.com.br');

    // Should set auth cookies
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    const cookieStr = Array.isArray(cookies) ? cookies.join(';') : cookies;
    expect(cookieStr).toMatch(/access_token/);
  });

  it('should reject wrong password', async () => {
    await createTestUser({
      email: 'user2@empresa.com.br',
      password: STRONG_PASSWORD,
      emailConfirmed: true,
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ emailOrCnpj: 'user2@empresa.com.br', password: 'WrongPass999!' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/inválidas/i);
  });

  it('should reject non-existent email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ emailOrCnpj: 'naoexiste@empresa.com.br', password: STRONG_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/inválidas/i);
  });

  it('should reject login when email is not confirmed', async () => {
    await createTestUser({
      email: 'unconfirmed@empresa.com.br',
      password: STRONG_PASSWORD,
      emailConfirmed: false,
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ emailOrCnpj: 'unconfirmed@empresa.com.br', password: STRONG_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('email_not_confirmed');
  });

  it('should reject login for rejected/banned user', async () => {
    await createTestUser({
      email: 'banned@empresa.com.br',
      password: STRONG_PASSWORD,
      emailConfirmed: true,
      status: 'rejected',
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ emailOrCnpj: 'banned@empresa.com.br', password: STRONG_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/inválidas/i);
  });

  it('should reject when emailOrCnpj is missing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: STRONG_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/obrigatório/i);
  });

  it('should allow login via CNPJ', async () => {
    await createTestUser({
      email: 'cnpjuser@empresa.com.br',
      password: STRONG_PASSWORD,
      cpfOrCnpj: '99888777000166',
      emailConfirmed: true,
      status: 'approved',
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ emailOrCnpj: '99888777000166', password: STRONG_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('cnpjuser@empresa.com.br');
  });
});

// ─────────────────────────────────────────────────
// GET /api/auth/me
// ─────────────────────────────────────────────────
describe('GET /api/auth/me', () => {
  it('should return current user when authenticated', async () => {
    const { user, auth } = await createAuthenticatedUser({
      email: 'me@empresa.com.br',
      companyName: 'Me Corp',
    });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe('me@empresa.com.br');
    expect(res.body.companyName).toBe('Me Corp');
    expect(res.body.id).toBeDefined();
    // Password should never be returned
    expect(res.body.password).toBeUndefined();
  });

  it('should return 401 when not authenticated', async () => {
    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });

  it('should return 401 with invalid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', ['access_token=invalid.jwt.token']);

    expect(res.status).toBe(401);
  });

  it('should return 403 for pending user', async () => {
    const { auth } = await createAuthenticatedUser({
      status: 'pending',
    });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/suspensa|pendente/i);
  });
});

// ─────────────────────────────────────────────────
// PUT /api/auth/change-password
// ─────────────────────────────────────────────────
describe('PUT /api/auth/change-password', () => {
  it('should change password successfully', async () => {
    const { user, auth } = await createAuthenticatedUser({
      password: STRONG_PASSWORD,
    });

    const newPassword = 'NewSecure123!@#';

    const res = await request(app)
      .put('/api/auth/change-password')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ currentPassword: STRONG_PASSWORD, newPassword });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/sucesso/i);

    // Verify password was actually changed
    const updatedUser = await User.findById(user._id);
    const isNew = await bcrypt.compare(newPassword, updatedUser!.password);
    expect(isNew).toBe(true);
  });

  it('should reject wrong current password', async () => {
    const { auth } = await createAuthenticatedUser();

    const res = await request(app)
      .put('/api/auth/change-password')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ currentPassword: 'WrongOldPass!1', newPassword: 'NewSecure123!@#' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/incorreta/i);
  });

  it('should reject weak new password', async () => {
    const { auth } = await createAuthenticatedUser({ password: STRONG_PASSWORD });

    const res = await request(app)
      .put('/api/auth/change-password')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ currentPassword: STRONG_PASSWORD, newPassword: 'weak' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('should reject when fields are missing', async () => {
    const { auth } = await createAuthenticatedUser();

    const res = await request(app)
      .put('/api/auth/change-password')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({});

    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────
// POST /api/auth/forgot-password
// ─────────────────────────────────────────────────
describe('POST /api/auth/forgot-password', () => {
  it('should return generic success for existing email', async () => {
    await createTestUser({ email: 'exists@empresa.com.br' });

    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'exists@empresa.com.br' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/cadastrado/i);
  });

  it('should return same generic response for non-existent email (anti-enumeration)', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'naoexiste@empresa.com.br' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/cadastrado/i);
  });

  it('should reject when email is missing', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/obrigatório/i);
  });
});

// ─────────────────────────────────────────────────
// POST /api/auth/refresh
// ─────────────────────────────────────────────────
describe('POST /api/auth/refresh', () => {
  it('should return 401 when no refresh_token cookie is present', async () => {
    const res = await request(app)
      .post('/api/auth/refresh');

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/refresh token/i);
  });

  it('should return 401 for invalid refresh token', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', ['refresh_token=invalid-random-token-value']);

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────
// POST /api/auth/logout
// ─────────────────────────────────────────────────
describe('POST /api/auth/logout', () => {
  it('should logout and clear cookies', async () => {
    const { auth } = await createAuthenticatedUser();

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/logout/i);

    // Verify cookies are cleared
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    const cookieStr = Array.isArray(cookies) ? cookies.join(';') : cookies;
    // Cleared cookies have empty value or max-age=0 / expires in the past
    expect(cookieStr).toMatch(/access_token=/);
  });

  it('should succeed even without auth (semi-public)', async () => {
    const res = await request(app)
      .post('/api/auth/logout');

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/logout/i);
  });
});

// ─────────────────────────────────────────────────
// GET /api/auth/confirm-email/:token
// ─────────────────────────────────────────────────
describe('GET /api/auth/confirm-email/:token', () => {
  it('confirma email com token valido', async () => {
    const token = 'valid-confirm-token-xyz123456789';
    await User.create({
      name: 'Confirmar User',
      email: 'confirmar@empresa.com.br',
      password: STRONG_PASSWORD,
      userType: 'advertiser',
      status: 'approved',
      emailConfirmed: false,
      companyName: 'Test Co',
      phone: '11999999999',
      cpfOrCnpj: '12345678000100',
      emailConfirmToken: token,
      emailConfirmTokenExpires: new Date(Date.now() + 3600000),
    });

    const res = await request(app)
      .get(`/api/auth/confirm-email/${token}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/confirmado/i);

    const updated = await User.findOne({ email: 'confirmar@empresa.com.br' });
    expect(updated?.emailConfirmed).toBe(true);
  });

  it('retorna 400 para token invalido', async () => {
    const res = await request(app)
      .get('/api/auth/confirm-email/token-invalido-99999');

    expect(res.status).toBe(400);
  });

  it('retorna 400 para token expirado', async () => {
    const token = 'expired-token-abc123456789012';
    await User.create({
      name: 'Expirado User',
      email: 'expirado@empresa.com.br',
      password: STRONG_PASSWORD,
      userType: 'advertiser',
      status: 'approved',
      emailConfirmed: false,
      companyName: 'Test Co',
      phone: '11999999999',
      cpfOrCnpj: '12345678000101',
      emailConfirmToken: token,
      emailConfirmTokenExpires: new Date(Date.now() - 1000),
    });

    const res = await request(app)
      .get(`/api/auth/confirm-email/${token}`);

    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────
// PUT /api/auth/update-profile
// ─────────────────────────────────────────────────
describe('PUT /api/auth/update-profile', () => {
  it('atualiza nome do usuario autenticado', async () => {
    const { auth } = await createAuthenticatedUser({ name: 'Nome Antigo' });

    const res = await request(app)
      .put('/api/auth/update-profile')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'Nome Novo' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/atualizado/i);
    expect(res.body.user.name).toBe('Nome Novo');
  });

  it('retorna 401 sem autenticacao', async () => {
    const res = await request(app)
      .put('/api/auth/update-profile')
      .send({ name: 'X' });

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────
// POST /api/auth/reset-password/:token
// ─────────────────────────────────────────────────
describe('POST /api/auth/reset-password/:token', () => {
  it('redefine senha com token valido', async () => {
    const token = 'valid-reset-token-xyz123456789';
    await User.create({
      name: 'Reset User',
      email: 'resetar@empresa.com.br',
      password: STRONG_PASSWORD,
      userType: 'advertiser',
      status: 'approved',
      emailConfirmed: true,
      companyName: 'Test Co',
      phone: '11999999999',
      cpfOrCnpj: '12345678000102',
      passwordResetToken: token,
      passwordResetTokenExpires: new Date(Date.now() + 3600000),
    });

    const res = await request(app)
      .post(`/api/auth/reset-password/${token}`)
      .send({ password: 'NovaSenha123!@#' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/redefinida/i);
  });

  it('retorna 400 para senha fraca', async () => {
    const token = 'token-senha-fraca';
    await createTestUser({
      email: 'resetfraco@empresa.com.br',
      passwordResetToken: token,
      passwordResetTokenExpires: new Date(Date.now() + 3600000),
    } as any);

    const res = await request(app)
      .post(`/api/auth/reset-password/${token}`)
      .send({ password: 'fraca' });

    expect(res.status).toBe(400);
  });

  it('retorna 400 para token invalido', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password/token-nao-existe')
      .send({ password: 'SenhaForte123!@#' });

    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────
// GET /api/auth/2fa/status
// ─────────────────────────────────────────────────
describe('GET /api/auth/2fa/status', () => {
  it('retorna status 2FA do usuario autenticado', async () => {
    const { auth } = await createAuthenticatedUser();

    const res = await request(app)
      .get('/api/auth/2fa/status')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('enabled');
  });

  it('retorna 401 sem autenticacao', async () => {
    const res = await request(app).get('/api/auth/2fa/status');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────
// POST /api/auth/2fa/enable
// ─────────────────────────────────────────────────
describe('POST /api/auth/2fa/enable', () => {
  it('envia email de confirmacao para habilitar 2FA', async () => {
    const { auth } = await createAuthenticatedUser();

    const res = await request(app)
      .post('/api/auth/2fa/enable')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/confirmação/i);
  });

  it('retorna 401 sem autenticacao', async () => {
    const res = await request(app).post('/api/auth/2fa/enable');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────
// POST /api/auth/2fa/disable
// ─────────────────────────────────────────────────
describe('POST /api/auth/2fa/disable', () => {
  it('retorna 401 com senha incorreta', async () => {
    const { auth } = await createAuthenticatedUser({ password: STRONG_PASSWORD });

    const res = await request(app)
      .post('/api/auth/2fa/disable')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ password: 'SenhaErrada999!' });

    expect(res.status).toBe(401);
  });

  it('retorna 401 sem autenticacao', async () => {
    const res = await request(app)
      .post('/api/auth/2fa/disable')
      .send({ password: STRONG_PASSWORD });

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────
// PATCH /api/auth/completed-tours
// ─────────────────────────────────────────────────
describe('PATCH /api/auth/completed-tours', () => {
  it('adiciona tourId aos completedTours', async () => {
    const { auth } = await createAuthenticatedUser();

    const res = await request(app)
      .patch('/api/auth/completed-tours')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ tourId: 'dashboard-tour-v1' });

    expect(res.status).toBe(200);
    expect(res.body.completedTours).toContain('dashboard-tour-v1');
  });

  it('nao duplica tourId ja existente', async () => {
    const { auth } = await createAuthenticatedUser();

    await request(app)
      .patch('/api/auth/completed-tours')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ tourId: 'tour-duplicado' });

    const res = await request(app)
      .patch('/api/auth/completed-tours')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ tourId: 'tour-duplicado' });

    expect(res.status).toBe(200);
    const count = res.body.completedTours.filter((t: string) => t === 'tour-duplicado').length;
    expect(count).toBe(1);
  });

  it('retorna 400 sem tourId', async () => {
    const { auth } = await createAuthenticatedUser();

    const res = await request(app)
      .patch('/api/auth/completed-tours')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({});

    expect(res.status).toBe(400);
  });

  it('retorna 401 sem autenticacao', async () => {
    const res = await request(app)
      .patch('/api/auth/completed-tours')
      .send({ tourId: 'x' });

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────
// GET /api/auth/2fa/confirm/:token
// ─────────────────────────────────────────────────
describe('GET /api/auth/2fa/confirm/:token', () => {
  it('confirma habilitacao de 2FA com token valido', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    const { user } = await createAuthenticatedUser();
    await User.findByIdAndUpdate(user._id, {
      twoFactorPendingToken: token,
      twoFactorPendingTokenExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
      twoFactorEnabled: false,
    });

    const res = await request(app).get(`/api/auth/2fa/confirm/${token}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/habilitada/i);
  });

  it('retorna 400 para token invalido', async () => {
    const res = await request(app).get('/api/auth/2fa/confirm/token-que-nao-existe');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/inválido|expirado/i);
  });

  it('retorna 400 para token expirado', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    const { user } = await createAuthenticatedUser();
    await User.findByIdAndUpdate(user._id, {
      twoFactorPendingToken: token,
      twoFactorPendingTokenExpires: new Date(Date.now() - 1000),
      twoFactorEnabled: false,
    });

    const res = await request(app).get(`/api/auth/2fa/confirm/${token}`);
    expect(res.status).toBe(400);
  });

  it('ativa twoFactorEnabled no banco apos confirmacao', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    const { user } = await createAuthenticatedUser();
    await User.findByIdAndUpdate(user._id, {
      twoFactorPendingToken: token,
      twoFactorPendingTokenExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
      twoFactorEnabled: false,
    });

    await request(app).get(`/api/auth/2fa/confirm/${token}`);

    const updated = await User.findById(user._id);
    expect(updated!.twoFactorEnabled).toBe(true);
    expect(updated!.twoFactorConfirmedAt).toBeDefined();
    expect(updated!.twoFactorPendingToken).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────
// POST /api/auth/2fa/disable — happy path
// ─────────────────────────────────────────────────
describe('POST /api/auth/2fa/disable — happy path', () => {
  it('desabilita 2FA com senha correta', async () => {
    const { user, auth } = await createAuthenticatedUser({ password: STRONG_PASSWORD });
    await User.findByIdAndUpdate(user._id, {
      twoFactorEnabled: true,
      twoFactorConfirmedAt: new Date(),
    });

    const res = await request(app)
      .post('/api/auth/2fa/disable')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ password: STRONG_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/desabilitada/i);

    const updated = await User.findById(user._id);
    expect(updated!.twoFactorEnabled).toBe(false);
  });
});

// ─────────────────────────────────────────────────
// POST /api/auth/login com usuario 2FA habilitado
// ─────────────────────────────────────────────────
describe('POST /api/auth/login com 2FA ativo', () => {
  it('retorna requiresTwoFactor ao inves de jwt quando 2FA esta habilitado', async () => {
    const { user } = await createAuthenticatedUser({
      email: `user2fa-${Date.now()}@empresa.com.br`,
      password: STRONG_PASSWORD,
    });
    await User.findByIdAndUpdate(user._id, {
      twoFactorEnabled: true,
      twoFactorConfirmedAt: new Date(),
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ emailOrCnpj: user.email, password: STRONG_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.requiresTwoFactor).toBe(true);
    expect(res.body.userId).toBeDefined();
    // Nao deve setar cookies de autenticacao ainda
    const cookies = res.headers['set-cookie'] as string[] | undefined;
    const hasAccessToken = cookies?.some((c: string) => c.startsWith('access_token='));
    expect(hasAccessToken).toBeFalsy();
  });
});

// POST /api/auth/2fa/verify-code — testado em auth2fa.test.ts (arquivo separado para evitar rate limiter compartilhado)
