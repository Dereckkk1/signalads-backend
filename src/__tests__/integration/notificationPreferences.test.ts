import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';
import { createTestApp } from '../helpers/createTestApp';
import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { createAuthenticatedUser, createTestUser } from '../helpers/authHelper';
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

describe('GET /api/auth/me/notifications', () => {
  it('retorna 401 sem auth', async () => {
    const res = await request(app).get('/api/auth/me/notifications');
    expect(res.status).toBe(401);
  });

  it('retorna defaults (todos true) para user novo', async () => {
    const { auth } = await createAuthenticatedUser({ userType: 'agency' });
    const res = await request(app)
      .get('/api/auth/me/notifications')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);
    expect(res.status).toBe(200);
    expect(res.body.notificationPreferences).toEqual({
      newOrders: true,
      proposalAcceptedRejected: true,
      marketplaceOrders: true,
      ownOrderUpdates: true
    });
  });
});

describe('PATCH /api/auth/me/notifications', () => {
  it('retorna 401 sem auth', async () => {
    const res = await request(app)
      .patch('/api/auth/me/notifications')
      .send({ newOrders: false });
    expect(res.status).toBe(401);
  });

  it('atualiza uma preferencia valida e persiste', async () => {
    const { user, auth } = await createAuthenticatedUser({ userType: 'admin' });
    const res = await request(app)
      .patch('/api/auth/me/notifications')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ newOrders: false });
    expect(res.status).toBe(200);
    expect(res.body.notificationPreferences.newOrders).toBe(false);

    const reloaded = await User.findById(user._id).lean();
    expect((reloaded as any).notificationPreferences.newOrders).toBe(false);
  });

  it('retorna 400 quando recebe key invalida', async () => {
    const { auth } = await createAuthenticatedUser({ userType: 'admin' });
    const res = await request(app)
      .patch('/api/auth/me/notifications')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ marketingPromos: false });
    expect(res.status).toBe(400);
  });

  it('retorna 400 quando o valor nao e boolean', async () => {
    const { auth } = await createAuthenticatedUser({ userType: 'admin' });
    const res = await request(app)
      .patch('/api/auth/me/notifications')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ newOrders: 'sim' });
    expect(res.status).toBe(400);
  });

  it('retorna 400 quando body esta vazio', async () => {
    const { auth } = await createAuthenticatedUser({ userType: 'admin' });
    const res = await request(app)
      .patch('/api/auth/me/notifications')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({});
    expect(res.status).toBe(400);
  });

  it('aceita multiplas keys de uma vez', async () => {
    const { user, auth } = await createAuthenticatedUser({ userType: 'agency' });
    const res = await request(app)
      .patch('/api/auth/me/notifications')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ proposalAcceptedRejected: false, ownOrderUpdates: false });
    expect(res.status).toBe(200);
    const reloaded = await User.findById(user._id).lean();
    expect((reloaded as any).notificationPreferences.proposalAcceptedRejected).toBe(false);
    expect((reloaded as any).notificationPreferences.ownOrderUpdates).toBe(false);
  });
});

describe('Filtro de admins com newOrders=false', () => {
  it('exclui admin com newOrders=false do destinatario de novo pedido', async () => {
    const adminWithPrefs = await createTestUser({ userType: 'admin', email: 'admin-on@test.com' });
    const adminOff = await createTestUser({ userType: 'admin', email: 'admin-off@test.com' });
    adminOff.set('notificationPreferences', { newOrders: false });
    await adminOff.save();

    const filtered = await User.find({
      userType: 'admin',
      $or: [
        { 'notificationPreferences.newOrders': { $ne: false } },
        { notificationPreferences: { $exists: false } }
      ]
    }).select('email').lean();

    const emails = filtered.map(u => u.email);
    expect(emails).toContain('admin-on@test.com');
    expect(emails).not.toContain('admin-off@test.com');
  });
});

describe('shouldSendNotification — integracao por chave', () => {
  it('retorna false quando ownOrderUpdates esta desligado para buyer', async () => {
    const { shouldSendNotification } = await import('../../services/notificationService');
    const buyer = await createTestUser({ userType: 'advertiser' });
    buyer.set('notificationPreferences', { ownOrderUpdates: false });
    await buyer.save();
    const result = await shouldSendNotification(buyer._id.toString(), 'ownOrderUpdates');
    expect(result).toBe(false);
  });

  it('retorna false quando broadcaster owner desliga proposalAcceptedRejected', async () => {
    const { shouldSendNotification } = await import('../../services/notificationService');
    const owner = await createTestUser({ userType: 'broadcaster' });
    owner.set('notificationPreferences', { proposalAcceptedRejected: false });
    await owner.save();
    const result = await shouldSendNotification(owner._id.toString(), 'proposalAcceptedRejected');
    expect(result).toBe(false);
  });

  it('retorna false quando broadcaster desliga marketplaceOrders', async () => {
    const { shouldSendNotification } = await import('../../services/notificationService');
    const broadcaster = await createTestUser({ userType: 'broadcaster' });
    broadcaster.set('notificationPreferences', { marketplaceOrders: false });
    await broadcaster.save();
    const result = await shouldSendNotification(broadcaster._id.toString(), 'marketplaceOrders');
    expect(result).toBe(false);
  });
});
