/**
 * Integration Tests — Monitoring API (Admin)
 *
 * Tests real HTTP endpoints end-to-end.
 * GET  /api/admin/monitoring/overview
 * GET  /api/admin/monitoring/routes
 * GET  /api/admin/monitoring/errors
 * GET  /api/admin/monitoring/vitals
 * GET  /api/admin/monitoring/slow
 * GET  /api/admin/monitoring/timeline
 * GET  /api/admin/monitoring/top-actors
 * GET  /api/admin/monitoring/actor-detail
 * GET  /api/admin/monitoring/blocked-ips
 * POST /api/admin/monitoring/block-ip
 * DELETE /api/admin/monitoring/block-ip/:ip
 * POST /api/admin/monitoring/block-user/:userId
 * POST /api/admin/monitoring/unblock-user/:userId
 */

import '../helpers/mocks';

// Mock blockedIPsSet to isolate in-memory state between tests
const mockBlockedIPsSet = new Set<string>();
jest.mock('../../utils/ipBlockList', () => ({
  blockedIPsSet: mockBlockedIPsSet,
  loadBlockedIPs: jest.fn().mockResolvedValue(undefined),
}));

// Mock the metrics middleware to avoid relying on runtime state
jest.mock('../../middleware/metrics', () => ({
  getGlobalStats: jest.fn().mockReturnValue({
    uptime: { seconds: 3600, human: '1h 0m' },
    requests: { total: 100, errors: 2, errorRate: '2.00%' },
    memory: { heapUsed: '50MB', heapTotal: '100MB', rss: '150MB' },
  }),
  metricsMiddleware: jest.fn((_req: any, _res: any, next: any) => next()),
  checkBlockedIP: jest.fn((_req: any, _res: any, next: any) => next()),
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
import BlockedIP from '../../models/BlockedIP';

let app: Application;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret-key-for-testing-12345';
  process.env.NODE_ENV = 'test';
  await connectTestDB();
  app = createTestApp(); // adminRoutes is already included
});

afterEach(async () => {
  await clearTestDB();
  mockBlockedIPsSet.clear();
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
      userId: 'user-abc',
      userEmail: 'test@example.com',
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
      userId: 'user-abc',
      userEmail: 'test@example.com',
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

// ─────────────────────────────────────────────────
// GET /api/admin/monitoring/top-actors
// ─────────────────────────────────────────────────
describe('GET /api/admin/monitoring/top-actors', () => {
  it('should aggregate requests by ip+userId and return actors sorted by count', async () => {
    await seedMetrics();
    const { auth } = await createAdmin();

    const res = await request(app)
      .get('/api/admin/monitoring/top-actors')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.actors).toBeDefined();
    expect(Array.isArray(res.body.actors)).toBe(true);
    expect(res.body.totalActors).toBeGreaterThan(0);

    // IP 192.168.1.1 has 2 requests — should appear first
    const topActor = res.body.actors[0];
    expect(topActor.ip).toBe('192.168.1.1');
    expect(topActor.totalRequests).toBe(2);
    expect(topActor.userId).toBe('user-abc');
    expect(topActor.userEmail).toBe('test@example.com');
    expect(topActor.riskLevel).toBe('low');
    expect(topActor.isIPBlocked).toBe(false);
  });

  it('should mark actor as blocked when IP is in BlockedIP collection', async () => {
    await seedMetrics();
    await BlockedIP.create({ ip: '192.168.1.1', reason: 'test block', blockedAt: new Date() });
    const { auth } = await createAdmin();

    const res = await request(app)
      .get('/api/admin/monitoring/top-actors')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    const actor = res.body.actors.find((a: any) => a.ip === '192.168.1.1');
    expect(actor.isIPBlocked).toBe(true);
  });

  it('should return correct risk levels based on request count', async () => {
    // Seed 500+ requests for a single IP to trigger critical risk
    const now = new Date();
    const bulkMetrics = Array.from({ length: 500 }, () => ({
      route: '/api/products', method: 'GET', statusCode: 200,
      duration: 100, isError: false, isSlow: false, timestamp: now, ip: '99.99.99.99',
    }));
    await SystemMetric.insertMany(bulkMetrics);
    const { auth } = await createAdmin();

    const res = await request(app)
      .get('/api/admin/monitoring/top-actors')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    const criticalActor = res.body.actors.find((a: any) => a.ip === '99.99.99.99');
    expect(criticalActor.riskLevel).toBe('critical');
  });

  it('should return 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/admin/monitoring/top-actors');
    expect(res.status).toBe(401);
  });

  it('should return 403 for non-admin', async () => {
    const { auth } = await createAdvertiser();
    const res = await request(app)
      .get('/api/admin/monitoring/top-actors')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────
// GET /api/admin/monitoring/actor-detail
// ─────────────────────────────────────────────────
describe('GET /api/admin/monitoring/actor-detail', () => {
  it('should return requests, timeline and top routes for a given IP', async () => {
    await seedMetrics();
    const { auth } = await createAdmin();

    const res = await request(app)
      .get('/api/admin/monitoring/actor-detail?ip=192.168.1.1')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.requests).toBeDefined();
    expect(res.body.timeline).toBeDefined();
    expect(res.body.topRoutes).toBeDefined();
    expect(res.body.requests.length).toBe(2);
    expect(res.body.topRoutes[0].route).toBe('/api/products');
    expect(res.body.topRoutes[0].count).toBe(2);
  });

  it('should return empty arrays when no data matches the IP', async () => {
    const { auth } = await createAdmin();

    const res = await request(app)
      .get('/api/admin/monitoring/actor-detail?ip=1.2.3.4')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.requests).toHaveLength(0);
    expect(res.body.topRoutes).toHaveLength(0);
  });

  it('should return 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/admin/monitoring/actor-detail?ip=1.2.3.4');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────
// POST /api/admin/monitoring/block-ip
// DELETE /api/admin/monitoring/block-ip/:ip
// GET /api/admin/monitoring/blocked-ips
// ─────────────────────────────────────────────────
describe('IP blocking endpoints', () => {
  it('POST /block-ip should persist the IP in DB and add to in-memory set', async () => {
    const { auth } = await createAdmin();

    const res = await request(app)
      .post('/api/admin/monitoring/block-ip')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ ip: '1.2.3.4', reason: 'scraping attempt' });

    expect(res.status).toBe(200);
    expect(res.body.ip).toBe('1.2.3.4');

    const inDb = await BlockedIP.findOne({ ip: '1.2.3.4' });
    expect(inDb).not.toBeNull();
    expect(inDb!.reason).toBe('scraping attempt');
    expect(mockBlockedIPsSet.has('1.2.3.4')).toBe(true);
  });

  it('POST /block-ip should return 400 when ip is missing', async () => {
    const { auth } = await createAdmin();

    const res = await request(app)
      .post('/api/admin/monitoring/block-ip')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('POST /block-ip should be idempotent (upsert)', async () => {
    const { auth } = await createAdmin();

    await request(app)
      .post('/api/admin/monitoring/block-ip')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ ip: '5.5.5.5', reason: 'first' });

    await request(app)
      .post('/api/admin/monitoring/block-ip')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ ip: '5.5.5.5', reason: 'second' });

    const count = await BlockedIP.countDocuments({ ip: '5.5.5.5' });
    expect(count).toBe(1);
  });

  it('DELETE /block-ip/:ip should remove from DB and in-memory set', async () => {
    const { auth } = await createAdmin();
    await BlockedIP.create({ ip: '9.9.9.9', blockedAt: new Date() });
    mockBlockedIPsSet.add('9.9.9.9');

    const res = await request(app)
      .delete('/api/admin/monitoring/block-ip/9.9.9.9')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.ip).toBe('9.9.9.9');

    const inDb = await BlockedIP.findOne({ ip: '9.9.9.9' });
    expect(inDb).toBeNull();
    expect(mockBlockedIPsSet.has('9.9.9.9')).toBe(false);
  });

  it('GET /blocked-ips should list all blocked IPs', async () => {
    await BlockedIP.insertMany([
      { ip: '10.0.0.1', reason: 'spam', blockedAt: new Date() },
      { ip: '10.0.0.2', reason: 'scraping', blockedAt: new Date() },
    ]);
    const { auth } = await createAdmin();

    const res = await request(app)
      .get('/api/admin/monitoring/blocked-ips')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.blockedIPs).toHaveLength(2);
    const ips = res.body.blockedIPs.map((b: any) => b.ip);
    expect(ips).toContain('10.0.0.1');
    expect(ips).toContain('10.0.0.2');
  });

  it('IP blocking endpoints should return 401 when unauthenticated', async () => {
    const [r1, r2, r3] = await Promise.all([
      request(app).post('/api/admin/monitoring/block-ip').send({ ip: '1.2.3.4' }),
      request(app).delete('/api/admin/monitoring/block-ip/1.2.3.4'),
      request(app).get('/api/admin/monitoring/blocked-ips'),
    ]);
    expect(r1.status).toBe(401);
    expect(r2.status).toBe(401);
    expect(r3.status).toBe(401);
  });

  it('IP blocking endpoints should return 403 for non-admin', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .post('/api/admin/monitoring/block-ip')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ ip: '1.2.3.4' });

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────
// POST /api/admin/monitoring/block-user/:userId
// POST /api/admin/monitoring/unblock-user/:userId
// ─────────────────────────────────────────────────
describe('User blocking endpoints', () => {
  it('POST /block-user/:userId should set user status to blocked and invalidate cache', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: advertiser } = await createAdvertiser();

    const res = await request(app)
      .post(`/api/admin/monitoring/block-user/${advertiser._id}`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(String(advertiser._id));

    // Verify user status in DB
    const { User } = await import('../../models/User');
    const updated = await User.findById(advertiser._id);
    expect(updated!.status).toBe('blocked');
  });

  it('POST /block-user/:userId should return 404 for non-existent user', async () => {
    const { auth } = await createAdmin();

    const res = await request(app)
      .post('/api/admin/monitoring/block-user/000000000000000000000000')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(404);
  });

  it('POST /unblock-user/:userId should restore status to approved', async () => {
    const { auth: adminAuth } = await createAdmin();
    const { user: advertiser } = await createAdvertiser();

    // Block first
    await request(app)
      .post(`/api/admin/monitoring/block-user/${advertiser._id}`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    // Then unblock
    const res = await request(app)
      .post(`/api/admin/monitoring/unblock-user/${advertiser._id}`)
      .set('Cookie', adminAuth.cookieHeader)
      .set('X-CSRF-Token', adminAuth.csrfHeader);

    expect(res.status).toBe(200);

    const { User } = await import('../../models/User');
    const updated = await User.findById(advertiser._id);
    expect(updated!.status).toBe('approved');
  });

  it('POST /block-user should return 401 when unauthenticated', async () => {
    const res = await request(app)
      .post('/api/admin/monitoring/block-user/000000000000000000000000');
    expect(res.status).toBe(401);
  });

  it('POST /block-user should return 403 for non-admin', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .post('/api/admin/monitoring/block-user/000000000000000000000000')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });
});
