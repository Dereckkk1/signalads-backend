/**
 * Integration Tests — Monitoring API (Admin)
 *
 * Tests real HTTP endpoints end-to-end.
 * GET /api/admin/monitoring/overview
 * GET /api/admin/monitoring/routes
 * GET /api/admin/monitoring/errors
 * GET /api/admin/monitoring/vitals
 * GET /api/admin/monitoring/slow
 * GET /api/admin/monitoring/timeline
 */

import '../helpers/mocks';

// Mock the metrics middleware getGlobalStats to avoid relying on runtime state
jest.mock('../../middleware/metrics', () => ({
  getGlobalStats: jest.fn().mockReturnValue({
    uptime: { seconds: 3600, human: '1h 0m' },
    requests: { total: 100, errors: 2, errorRate: '2.00%' },
    memory: { heapUsed: '50MB', heapTotal: '100MB', rss: '150MB' },
  }),
  metricsMiddleware: jest.fn((_req: any, _res: any, next: any) => next()),
}));

import request from 'supertest';
import { Application } from 'express';

import { createTestApp } from '../helpers/createTestApp';
import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import {
  createAdmin,
  createAdvertiser,
} from '../helpers/authHelper';
import SystemMetric from '../../models/SystemMetric';
import WebVital from '../../models/WebVital';

let app: Application;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret-key-for-testing-12345';
  process.env.NODE_ENV = 'test';
  await connectTestDB();
  app = createTestApp(); // adminRoutes is already included
});

afterEach(async () => {
  await clearTestDB();
});

afterAll(async () => {
  await disconnectTestDB();
});

/** Helper: seed some system metrics */
async function seedMetrics() {
  const now = new Date();
  const metrics = [
    {
      route: '/api/products',
      method: 'GET',
      statusCode: 200,
      duration: 150,
      isError: false,
      isSlow: false,
      timestamp: now,
      ip: '192.168.1.1',
    },
    {
      route: '/api/products',
      method: 'GET',
      statusCode: 200,
      duration: 80,
      isError: false,
      isSlow: false,
      timestamp: now,
      ip: '192.168.1.1',
    },
    {
      route: '/api/auth/login',
      method: 'POST',
      statusCode: 500,
      duration: 3000,
      isError: true,
      isSlow: true,
      timestamp: now,
      ip: '10.0.0.1',
    },
    {
      route: '/api/cart',
      method: 'GET',
      statusCode: 200,
      duration: 2500,
      isError: false,
      isSlow: true,
      timestamp: now,
      ip: '192.168.1.2',
    },
  ];
  await SystemMetric.insertMany(metrics);
}

/** Helper: seed some web vitals */
async function seedVitals() {
  const now = new Date();
  const vitals = [
    { name: 'LCP', value: 2500, rating: 'good', page: '/marketplace', timestamp: now },
    { name: 'LCP', value: 4000, rating: 'poor', page: '/marketplace', timestamp: now },
    { name: 'FID', value: 100, rating: 'good', page: '/marketplace', timestamp: now },
    { name: 'CLS', value: 0.05, rating: 'good', page: '/dashboard', timestamp: now },
  ];
  await WebVital.insertMany(vitals);
}

// ─────────────────────────────────────────────────
// GET /api/admin/monitoring/overview
// ─────────────────────────────────────────────────
describe('GET /api/admin/monitoring/overview', () => {
  it('should return overview with server stats and period data', async () => {
    await seedMetrics();
    const { auth } = await createAdmin();

    const res = await request(app)
      .get('/api/admin/monitoring/overview')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.server).toBeDefined();
    expect(res.body.period).toBeDefined();
    expect(res.body.period.totalRequests).toBe(4);
    expect(res.body.period.totalErrors).toBe(1);
    expect(res.body.period.totalSlow).toBe(2);
    expect(res.body.period.errorRate).toMatch(/%/);
  });

  it('should return 0 counts when no metrics exist', async () => {
    const { auth } = await createAdmin();

    const res = await request(app)
      .get('/api/admin/monitoring/overview')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.period.totalRequests).toBe(0);
    expect(res.body.period.totalErrors).toBe(0);
  });

  it('should return 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/admin/monitoring/overview');
    expect(res.status).toBe(401);
  });

  it('should return 403 for non-admin', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .get('/api/admin/monitoring/overview')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────
// GET /api/admin/monitoring/routes
// ─────────────────────────────────────────────────
describe('GET /api/admin/monitoring/routes', () => {
  it('should return route metrics with percentiles', async () => {
    await seedMetrics();
    const { auth } = await createAdmin();

    const res = await request(app)
      .get('/api/admin/monitoring/routes')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.totalRoutes).toBeGreaterThan(0);
    expect(res.body.routes).toBeDefined();
    expect(Array.isArray(res.body.routes)).toBe(true);

    const route = res.body.routes[0];
    expect(route.route).toBeDefined();
    expect(route.count).toBeDefined();
    expect(route.p50).toBeDefined();
    expect(route.p95).toBeDefined();
    expect(route.health).toBeDefined();
  });
});

// ─────────────────────────────────────────────────
// GET /api/admin/monitoring/errors
// ─────────────────────────────────────────────────
describe('GET /api/admin/monitoring/errors', () => {
  it('should return error metrics', async () => {
    await seedMetrics();
    const { auth } = await createAdmin();

    const res = await request(app)
      .get('/api/admin/monitoring/errors')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.totalErrors).toBe(1);
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0].route).toBe('/api/auth/login');
    expect(res.body.errors[0].statusCode).toBe(500);
  });

  it('should return empty errors when none exist', async () => {
    const { auth } = await createAdmin();

    const res = await request(app)
      .get('/api/admin/monitoring/errors')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.totalErrors).toBe(0);
    expect(res.body.errors).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────
// GET /api/admin/monitoring/vitals
// ─────────────────────────────────────────────────
describe('GET /api/admin/monitoring/vitals', () => {
  it('should return web vitals aggregated by name and page', async () => {
    await seedVitals();
    const { auth } = await createAdmin();

    const res = await request(app)
      .get('/api/admin/monitoring/vitals')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.vitals).toBeDefined();
    expect(Array.isArray(res.body.vitals)).toBe(true);
    expect(res.body.vitals.length).toBeGreaterThan(0);

    const vital = res.body.vitals[0];
    expect(vital.name).toBeDefined();
    expect(vital.page).toBeDefined();
    expect(vital.count).toBeDefined();
    expect(vital.avg).toBeDefined();
    expect(vital.p75).toBeDefined();
  });
});

// ─────────────────────────────────────────────────
// GET /api/admin/monitoring/slow
// ─────────────────────────────────────────────────
describe('GET /api/admin/monitoring/slow', () => {
  it('should return slow requests', async () => {
    await seedMetrics();
    const { auth } = await createAdmin();

    const res = await request(app)
      .get('/api/admin/monitoring/slow')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.totalSlow).toBe(2);
    expect(res.body.requests).toHaveLength(2);
    // Sorted by duration desc
    expect(res.body.requests[0].duration).toBeGreaterThanOrEqual(res.body.requests[1].duration);
  });
});

// ─────────────────────────────────────────────────
// GET /api/admin/monitoring/timeline
// ─────────────────────────────────────────────────
describe('GET /api/admin/monitoring/timeline', () => {
  it('should return timeline grouped by hour', async () => {
    await seedMetrics();
    const { auth } = await createAdmin();

    const res = await request(app)
      .get('/api/admin/monitoring/timeline?range=24h')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.groupedBy).toBe('hour');
    expect(res.body.timeline).toBeDefined();
    expect(Array.isArray(res.body.timeline)).toBe(true);

    if (res.body.timeline.length > 0) {
      const entry = res.body.timeline[0];
      expect(entry.period).toBeDefined();
      expect(entry.totalRequests).toBeDefined();
      expect(entry.totalErrors).toBeDefined();
    }
  });

  it('should group by day for 7d range', async () => {
    await seedMetrics();
    const { auth } = await createAdmin();

    const res = await request(app)
      .get('/api/admin/monitoring/timeline?range=7d')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.groupedBy).toBe('day');
  });
});
