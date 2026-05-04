/**
 * Integration Tests — Kanban API
 *
 * GET    /api/kanban/:context/board
 * POST   /api/kanban/:context/columns
 * PATCH  /api/kanban/:context/columns/:columnId
 * DELETE /api/kanban/:context/columns/:columnId
 * PUT    /api/kanban/:context/column-order
 * PUT    /api/kanban/:context/placements
 */

import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';
import mongoose from 'mongoose';

import { createTestApp } from '../helpers/createTestApp';
import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import {
  createAdmin,
  createBroadcaster,
  createAgency,
  createAdvertiser,
} from '../helpers/authHelper';
import { KanbanBoard } from '../../models/KanbanBoard';
import { KanbanCardPlacement } from '../../models/KanbanCardPlacement';
import Proposal from '../../models/Proposal';

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

const PINK = '#ec4899';
const BLUE = '#3b82f6';

// ─── GET /board ──────────────────────────────────────

describe('GET /api/kanban/:context/board', () => {
  it('returns empty board for new broadcaster (proposals context)', async () => {
    const { auth } = await createBroadcaster();
    const res = await request(app)
      .get('/api/kanban/proposals/board')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.customColumns).toEqual([]);
    expect(res.body.columnOrder).toEqual([]);
    expect(res.body.placements).toEqual([]);
  });

  it('returns empty board for admin (orders context)', async () => {
    const { auth } = await createAdmin();
    const res = await request(app)
      .get('/api/kanban/orders/board')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.customColumns).toEqual([]);
  });

  it('rejects admin trying to access proposals context', async () => {
    const { auth } = await createAdmin();
    const res = await request(app)
      .get('/api/kanban/proposals/board')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });

  it('rejects broadcaster trying to access orders context', async () => {
    const { auth } = await createBroadcaster();
    const res = await request(app)
      .get('/api/kanban/orders/board')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });

  it('rejects advertiser entirely', async () => {
    const { auth } = await createAdvertiser();
    const res = await request(app)
      .get('/api/kanban/proposals/board')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(403);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/kanban/proposals/board');
    expect(res.status).toBe(401);
  });

  it('rejects invalid context', async () => {
    const { auth } = await createBroadcaster();
    const res = await request(app)
      .get('/api/kanban/invalid/board')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(400);
  });
});

// ─── POST /columns ───────────────────────────────────

describe('POST /api/kanban/:context/columns', () => {
  it('creates a custom column for a broadcaster', async () => {
    const { auth } = await createBroadcaster();
    const res = await request(app)
      .post('/api/kanban/proposals/columns')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'Follow-up', color: PINK, icon: 'Target' });

    expect(res.status).toBe(201);
    expect(res.body.column.name).toBe('Follow-up');
    expect(res.body.column.color).toBe(PINK);
    expect(res.body.column.icon).toBe('Target');
    expect(res.body.columnOrder).toContain(res.body.column._id);
  });

  it('shares custom columns across broadcaster sub-users and manager', async () => {
    const { user: manager, auth: managerAuth } = await createBroadcaster();
    await request(app)
      .post('/api/kanban/proposals/columns')
      .set('Cookie', managerAuth.cookieHeader)
      .set('X-CSRF-Token', managerAuth.csrfHeader)
      .send({ name: 'Prospectando', color: BLUE, icon: 'Users' });

    // Simula sub-user com parentBroadcasterId
    const { createTestUser, generateAuthCookies } = await import(
      '../helpers/authHelper'
    );
    const subUser = await createTestUser({
      userType: 'broadcaster',
      email: `sales-${Date.now()}@emissora.com.br`,
      companyName: 'Sub User',
    });
    await (await import('../../models/User')).User.updateOne(
      { _id: subUser._id },
      { $set: { broadcasterRole: 'sales', parentBroadcasterId: manager._id } }
    );
    const subAuth = generateAuthCookies(subUser._id.toString());

    const res = await request(app)
      .get('/api/kanban/proposals/board')
      .set('Cookie', subAuth.cookieHeader)
      .set('X-CSRF-Token', subAuth.csrfHeader);

    expect(res.status).toBe(200);
    expect(res.body.customColumns.length).toBe(1);
    expect(res.body.customColumns[0].name).toBe('Prospectando');
  });

  it('rejects invalid color', async () => {
    const { auth } = await createBroadcaster();
    const res = await request(app)
      .post('/api/kanban/proposals/columns')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'Test', color: 'blue', icon: 'Target' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cor/i);
  });

  it('rejects empty name', async () => {
    const { auth } = await createBroadcaster();
    const res = await request(app)
      .post('/api/kanban/proposals/columns')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: '   ', color: PINK, icon: 'Target' });

    expect(res.status).toBe(400);
  });

  it('rejects name longer than 40 chars', async () => {
    const { auth } = await createBroadcaster();
    const res = await request(app)
      .post('/api/kanban/proposals/columns')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'x'.repeat(41), color: PINK, icon: 'Target' });

    expect(res.status).toBe(400);
  });

  it('rejects missing icon', async () => {
    const { auth } = await createBroadcaster();
    const res = await request(app)
      .post('/api/kanban/proposals/columns')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'Test', color: PINK });

    expect(res.status).toBe(400);
  });
});

// ─── PATCH /columns/:id ──────────────────────────────

describe('PATCH /api/kanban/:context/columns/:columnId', () => {
  it('updates name/color/icon', async () => {
    const { auth } = await createBroadcaster();
    const create = await request(app)
      .post('/api/kanban/proposals/columns')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'A', color: PINK, icon: 'Target' });

    const res = await request(app)
      .patch(`/api/kanban/proposals/columns/${create.body.column._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'B', color: BLUE });

    expect(res.status).toBe(200);
    expect(res.body.column.name).toBe('B');
    expect(res.body.column.color).toBe(BLUE);
    expect(res.body.column.icon).toBe('Target');
  });

  it('returns 404 for unknown column', async () => {
    const { auth } = await createBroadcaster();
    const res = await request(app)
      .patch(`/api/kanban/proposals/columns/${new mongoose.Types.ObjectId()}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'X' });

    expect(res.status).toBe(404);
  });
});

// ─── DELETE /columns/:id ─────────────────────────────

describe('DELETE /api/kanban/:context/columns/:columnId', () => {
  it('deletes column and its placements', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();
    const create = await request(app)
      .post('/api/kanban/proposals/columns')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'A', color: PINK, icon: 'Target' });

    const columnId = create.body.column._id;

    const fakeProposalId = new mongoose.Types.ObjectId();
    await KanbanCardPlacement.create({
      ownerType: 'broadcaster',
      ownerId: broadcaster._id,
      context: 'proposals',
      cardType: 'proposal',
      cardId: fakeProposalId,
      columnId,
    });

    const res = await request(app)
      .delete(`/api/kanban/proposals/columns/${columnId}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader);

    expect(res.status).toBe(200);
    const remaining = await KanbanCardPlacement.countDocuments({ columnId });
    expect(remaining).toBe(0);

    const board = await KanbanBoard.findOne({
      ownerType: 'broadcaster',
      ownerId: broadcaster._id,
      context: 'proposals',
    });
    expect(board?.customColumns.length).toBe(0);
    expect(board?.columnOrder.includes(String(columnId))).toBe(false);
  });
});

// ─── PUT /column-order ───────────────────────────────

describe('PUT /api/kanban/:context/column-order', () => {
  it('persists provided columnOrder', async () => {
    const { auth } = await createBroadcaster();
    const order = ['draft', 'sent', 'viewed'];

    const res = await request(app)
      .put('/api/kanban/proposals/column-order')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ columnOrder: order });

    expect(res.status).toBe(200);
    expect(res.body.columnOrder).toEqual(order);
  });

  it('rejects non-array payload', async () => {
    const { auth } = await createBroadcaster();
    const res = await request(app)
      .put('/api/kanban/proposals/column-order')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ columnOrder: 'not-an-array' });

    expect(res.status).toBe(400);
  });
});

// ─── PUT /placements ─────────────────────────────────

describe('PUT /api/kanban/:context/placements', () => {
  it('sets a placement when targeting a custom column', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();
    const create = await request(app)
      .post('/api/kanban/proposals/columns')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'Follow', color: PINK, icon: 'Target' });

    const columnId = create.body.column._id;

    // Card precisa existir e pertencer ao owner — controller valida via Proposal.exists
    const proposal = await Proposal.create({
      broadcasterId: broadcaster._id,
      title: 'Kanban Card',
      slug: `kanban-${Date.now()}`,
      items: [{ productName: 'Item', quantity: 1, unitPrice: 100, totalPrice: 100, productType: 'Comercial 30s', isCustom: true }],
      grossAmount: 100,
      totalAmount: 100,
      status: 'draft',
    });
    const cardId = (proposal._id as mongoose.Types.ObjectId).toString();

    const res = await request(app)
      .put('/api/kanban/proposals/placements')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ cardId, cardType: 'proposal', columnId });

    expect(res.status).toBe(200);
    expect(res.body.placement.columnId).toBe(columnId);

    const doc = await KanbanCardPlacement.findOne({
      ownerType: 'broadcaster',
      ownerId: broadcaster._id,
      cardId,
    });
    expect(doc).not.toBeNull();
    expect(doc?.columnId).toBe(columnId);
  });

  it('clears placement when columnId is null', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();
    const create = await request(app)
      .post('/api/kanban/proposals/columns')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'Follow', color: PINK, icon: 'Target' });

    const columnId = create.body.column._id;
    const cardId = new mongoose.Types.ObjectId().toString();

    await request(app)
      .put('/api/kanban/proposals/placements')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ cardId, cardType: 'proposal', columnId });

    const clear = await request(app)
      .put('/api/kanban/proposals/placements')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ cardId, cardType: 'proposal', columnId: null });

    expect(clear.status).toBe(200);
    expect(clear.body.cleared).toBe(true);

    const doc = await KanbanCardPlacement.findOne({
      ownerType: 'broadcaster',
      ownerId: broadcaster._id,
      cardId,
    });
    expect(doc).toBeNull();
  });

  it('rejects targeting a non-existent custom column', async () => {
    const { auth } = await createBroadcaster();
    const cardId = new mongoose.Types.ObjectId().toString();

    const res = await request(app)
      .put('/api/kanban/proposals/placements')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        cardId,
        cardType: 'proposal',
        columnId: new mongoose.Types.ObjectId().toString(),
      });

    expect(res.status).toBe(404);
  });

  it('rejects cardType mismatch with context', async () => {
    const { auth } = await createBroadcaster();
    const cardId = new mongoose.Types.ObjectId().toString();

    const res = await request(app)
      .put('/api/kanban/proposals/placements')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ cardId, cardType: 'order', columnId: null });

    expect(res.status).toBe(400);
  });
});

// ─── Scope isolation ─────────────────────────────────

describe('scope isolation', () => {
  it('two broadcasters do not share custom columns', async () => {
    const { auth: aAuth } = await createBroadcaster();
    const { auth: bAuth } = await createBroadcaster();

    await request(app)
      .post('/api/kanban/proposals/columns')
      .set('Cookie', aAuth.cookieHeader)
      .set('X-CSRF-Token', aAuth.csrfHeader)
      .send({ name: 'Emissora A', color: PINK, icon: 'Target' });

    const resB = await request(app)
      .get('/api/kanban/proposals/board')
      .set('Cookie', bAuth.cookieHeader)
      .set('X-CSRF-Token', bAuth.csrfHeader);

    expect(resB.body.customColumns.length).toBe(0);
  });

  it('all admins share the same board', async () => {
    const { auth: admin1 } = await createAdmin();
    const { auth: admin2 } = await createAdmin();

    await request(app)
      .post('/api/kanban/orders/columns')
      .set('Cookie', admin1.cookieHeader)
      .set('X-CSRF-Token', admin1.csrfHeader)
      .send({ name: 'Prioritario', color: PINK, icon: 'Flag' });

    const resB = await request(app)
      .get('/api/kanban/orders/board')
      .set('Cookie', admin2.cookieHeader)
      .set('X-CSRF-Token', admin2.csrfHeader);

    expect(resB.body.customColumns.length).toBe(1);
    expect(resB.body.customColumns[0].name).toBe('Prioritario');
  });
});
