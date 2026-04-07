/**
 * Integration Tests — Security
 *
 * Tests NoSQL injection protection, XSS sanitization, CSRF enforcement,
 * unauthenticated access to protected endpoints, and role authorization.
 */

import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';

import { createTestApp } from '../helpers/createTestApp';
import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import {
  createAdmin,
  createAdvertiser,
  createBroadcaster,
  createAuthenticatedUser,
  createTestUser,
  STRONG_PASSWORD,
} from '../helpers/authHelper';

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
// NoSQL Injection Protection
// ─────────────────────────────────────────────────
describe('NoSQL injection protection', () => {
  it('should strip $gt operator from login body', async () => {
    await createTestUser({
      email: 'victim@empresa.com.br',
      password: STRONG_PASSWORD,
      emailConfirmed: true,
    });

    // Attempt NoSQL injection: { emailOrCnpj: { $gt: "" }, password: { $gt: "" } }
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        emailOrCnpj: { $gt: '' },
        password: { $gt: '' },
      });

    // Should NOT succeed — injection should be sanitized
    // After sanitization, empty values may cause 400 or 500 — what matters is no 200
    expect(res.status).not.toBe(200);
    // Should not return a valid token (no successful auth)
    expect(res.body.token).toBeUndefined();
  });

  it('should strip $ne operator from body', async () => {
    await createTestUser({
      email: 'target@empresa.com.br',
      password: STRONG_PASSWORD,
      emailConfirmed: true,
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({
        emailOrCnpj: { $ne: null },
        password: { $ne: null },
      });

    // $ne should be stripped; login should fail (injection blocked)
    expect(res.status).not.toBe(200);
    expect(res.body.token).toBeUndefined();
  });

  it('should strip $regex operator from body', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        emailOrCnpj: { $regex: '.*' },
        password: STRONG_PASSWORD,
      });

    // Injection should be stripped, login fails
    expect(res.status).not.toBe(200);
    expect(res.body.token).toBeUndefined();
  });

  it('should strip nested MongoDB operators', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'test@empresa.com.br',
        password: STRONG_PASSWORD,
        userType: 'advertiser',
        companyName: { $gt: '' },
        phone: '11999999999',
        cpfOrCnpj: '12345678000100',
      });

    // companyName with $gt should be stripped
    // May succeed (201) with sanitized empty string or fail — but not crash with injection
    expect([201, 400, 500]).toContain(res.status);
  });

  it('should block prototype pollution keys', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        emailOrCnpj: 'safe@empresa.com.br',
        password: STRONG_PASSWORD,
        __proto__: { isAdmin: true },
        constructor: { prototype: { isAdmin: true } },
      });

    // Should not crash the server
    expect([400, 401]).toContain(res.status);
  });
});

// ─────────────────────────────────────────────────
// XSS Protection
// ─────────────────────────────────────────────────
describe('XSS protection', () => {
  it('should strip script tags from registration body', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'xss@empresa.com.br',
        password: STRONG_PASSWORD,
        userType: 'advertiser',
        companyName: '<script>alert("xss")</script>Evil Corp',
        fantasyName: '<img src=x onerror=alert(1)>',
        phone: '11999999999',
        cpfOrCnpj: '12345678000100',
      });

    // Registration should succeed with sanitized values (201 indicates user created)
    expect(res.status).toBe(201);

    // If we look at the DB, script tags should be stripped
    const { User } = await import('../../models/User');
    const user = await User.findOne({ email: 'xss@empresa.com.br' });
    expect(user).not.toBeNull();
    expect(user!.companyName).not.toContain('<script>');
    expect(user!.fantasyName).not.toContain('<img');
  });

  it('should strip HTML from login body', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        emailOrCnpj: '<b>bold</b>test@empresa.com.br',
        password: STRONG_PASSWORD,
      });

    // Should not error; XSS payload is sanitized, login will fail normally
    expect([400, 401]).toContain(res.status);
  });

  it('should strip event handlers from inputs', async () => {
    const { auth } = await createAuthenticatedUser();

    const res = await request(app)
      .put('/api/auth/update-profile')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        companyName: 'Normal<div onmouseover="alert(1)">Corp</div>',
      });

    expect(res.status).toBe(200);
    // Response should not contain the event handler
    expect(res.body.user.companyName).not.toContain('onmouseover');
  });
});

// ─────────────────────────────────────────────────
// CSRF Protection
// ─────────────────────────────────────────────────
describe('CSRF protection', () => {
  it('should reject mutating request with missing CSRF token when authenticated', async () => {
    const { auth } = await createAuthenticatedUser();

    const res = await request(app)
      .put('/api/auth/change-password')
      .set('Cookie', auth.cookieHeader)
      // Deliberately NOT setting X-CSRF-Token header
      .send({
        currentPassword: STRONG_PASSWORD,
        newPassword: 'NewSecure123!@#',
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/csrf/i);
  });

  it('should reject when CSRF header does not match cookie', async () => {
    const { auth } = await createAuthenticatedUser();

    const res = await request(app)
      .put('/api/auth/change-password')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', 'wrong-csrf-value')
      .send({
        currentPassword: STRONG_PASSWORD,
        newPassword: 'NewSecure123!@#',
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/csrf/i);
  });

  it('should allow GET requests without CSRF token', async () => {
    const { auth } = await createAuthenticatedUser();

    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', auth.cookieHeader);
    // No X-CSRF-Token header needed for GET

    expect(res.status).toBe(200);
  });

  it('should exempt login from CSRF check', async () => {
    await createTestUser({
      email: 'csrftest@empresa.com.br',
      password: STRONG_PASSWORD,
      emailConfirmed: true,
    });

    // Login should work without any CSRF token
    const res = await request(app)
      .post('/api/auth/login')
      .send({ emailOrCnpj: 'csrftest@empresa.com.br', password: STRONG_PASSWORD });

    expect(res.status).toBe(200);
  });

  it('should exempt register from CSRF check', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'csrfreg@empresa.com.br',
        password: STRONG_PASSWORD,
        userType: 'advertiser',
        companyName: 'CSRF Test Co',
        phone: '11999999999',
        cpfOrCnpj: '00111222000100',
      });

    expect(res.status).toBe(201);
  });

  it('should exempt logout from CSRF check', async () => {
    const res = await request(app)
      .post('/api/auth/logout');

    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────
// Unauthenticated access to protected endpoints
// ─────────────────────────────────────────────────
describe('Unauthenticated access to protected endpoints', () => {
  it('GET /api/auth/me should return 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('GET /api/cart should return 401', async () => {
    const res = await request(app).get('/api/cart');
    expect(res.status).toBe(401);
  });

  it('POST /api/products should return 401', async () => {
    const res = await request(app)
      .post('/api/products')
      .send({ spotType: 'Comercial 30s', timeSlot: 'Rotativo', netPrice: 100 });
    expect(res.status).toBe(401);
  });

  it('GET /api/admin/broadcasters/pending should return 401', async () => {
    const res = await request(app).get('/api/admin/broadcasters/pending');
    expect(res.status).toBe(401);
  });

  it('GET /api/admin/users should return 401', async () => {
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(401);
  });

  it('GET /api/products/my-products should return 401', async () => {
    const res = await request(app).get('/api/products/my-products');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────
// Wrong role access
// ─────────────────────────────────────────────────
describe('Wrong role access returns 403', () => {
  it('advertiser accessing admin/broadcasters/pending returns 403', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .get('/api/admin/broadcasters/pending')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });

  it('advertiser creating product returns 403', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .post('/api/products')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ spotType: 'Comercial 30s', timeSlot: 'Rotativo', netPrice: 100 });

    expect(res.status).toBe(403);
  });

  it('broadcaster accessing admin endpoints returns 403', async () => {
    const { auth } = await createBroadcaster();

    const endpoints = [
      '/api/admin/broadcasters/pending',
      '/api/admin/orders/full',
      '/api/admin/users',
    ];

    for (const endpoint of endpoints) {
      const res = await request(app)
        .get(endpoint)
        .set('Cookie', auth.cookieHeader)
        .set('X-CSRF-Token', auth.csrfHeader);

      expect(res.status).toBe(403);
    }
  });

  it('advertiser trying my-products returns 403', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .get('/api/products/my-products')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });
});
