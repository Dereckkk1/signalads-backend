/**
 * Integration Tests — processAutoApprovalForCatalogItems + campaignController branches
 *
 * processAutoApprovalForCatalogItems é uma função interna exportada que processa
 * auto-aprovação de pedidos com emissoras catálogo. Não tem rota própria — é chamada
 * via admin approval e via checkout.
 */

import '../helpers/mocks';

import mongoose from 'mongoose';
import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { processAutoApprovalForCatalogItems } from '../../controllers/campaignController';
import Order from '../../models/Order';
import { User } from '../../models/User';

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret-key-for-testing-12345';
  process.env.NODE_ENV = 'test';
  await connectTestDB();
});

afterEach(async () => {
  await clearTestDB();
});

afterAll(async () => {
  await disconnectTestDB();
});

// ─── Helpers ────────────────────────────────────────────────────
async function createCatalogBroadcaster() {
  return User.create({
    email: `catalog-${Date.now()}@emissora.com.br`,
    password: '$2a$04$fakehash',
    userType: 'broadcaster',
    status: 'approved',
    companyName: 'Radio Catalogo FM',
    phone: '11999998888',
    cpfOrCnpj: `CATALOG-${Date.now()}`,
    isCatalogOnly: true,
    emailConfirmed: true,
  });
}

async function createRegularBroadcaster() {
  return User.create({
    email: `regular-${Date.now()}@emissora.com.br`,
    password: '$2a$04$fakehash',
    userType: 'broadcaster',
    status: 'approved',
    companyName: 'Radio Regular FM',
    phone: '11999997777',
    cpfOrCnpj: `REGULAR-${Date.now()}`,
    isCatalogOnly: false,
    emailConfirmed: true,
  });
}

function makeOrderItem(broadcasterId: mongoose.Types.ObjectId) {
  return {
    broadcasterId,
    broadcasterName: 'Radio Test',
    productId: new mongoose.Types.ObjectId(),
    productName: 'Spot 30s',
    quantity: 2,
    unitPrice: 250,
    totalPrice: 500,
    itemStatus: 'pending',
    schedule: new Map([['seg-sex', 2]]),
  };
}

async function createTestOrder(items: any[], status = 'paid') {
  return Order.create({
    buyerId: new mongoose.Types.ObjectId(),
    buyerName: 'Comprador Teste',
    buyerEmail: 'buyer@test.com',
    buyerPhone: '11999999999',
    buyerDocument: '12345678000100',
    status,
    totalAmount: 500,
    grossAmount: 400,
    subtotal: 400,
    platformFee: 100,
    techFee: 25,
    platformSplit: 100,
    broadcasterAmount: 375,
    items,
    splits: [],
    payment: {
      method: 'pending_contact',
      status: 'pending',
      chargedAmount: 500,
      totalAmount: 500,
      walletAmountUsed: 0,
    },
  });
}

// ═══════════════════════════════════════════════════════════════
// processAutoApprovalForCatalogItems
// ═══════════════════════════════════════════════════════════════
describe('processAutoApprovalForCatalogItems', () => {
  it('retorna allCatalog=false quando orderId nao existe', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const result = await processAutoApprovalForCatalogItems(fakeId);

    expect(result.allCatalog).toBe(false);
    expect(result.autoApproved).toBe(false);
    expect(result.catalogItems).toHaveLength(0);
    expect(result.regularItems).toHaveLength(0);
  });

  it('identifica pedido apenas com emissoras regulares — nao auto-aprova', async () => {
    const broadcaster = await createRegularBroadcaster();
    const order = await createTestOrder([makeOrderItem(broadcaster._id)]);

    const result = await processAutoApprovalForCatalogItems(order._id.toString());

    expect(result.allCatalog).toBe(false);
    expect(result.autoApproved).toBe(false);
    expect(result.regularItems.length).toBeGreaterThan(0);
  });

  it('identifica pedido apenas com emissoras catalogo — auto-aprova', async () => {
    const catalogBroadcaster = await createCatalogBroadcaster();
    const order = await createTestOrder([makeOrderItem(catalogBroadcaster._id)]);

    const result = await processAutoApprovalForCatalogItems(order._id.toString());

    expect(result.allCatalog).toBe(true);
    expect(result.autoApproved).toBe(true);
    expect(result.catalogItems.length).toBeGreaterThan(0);
    expect(result.regularItems).toHaveLength(0);

    // Pedido deve ter status aprovado no banco
    const updated = await Order.findById(order._id);
    expect(updated!.status).toBe('approved');
  });

  it('pedido misto (catalogo + regular) — nao auto-aprova, retorna allCatalog=false', async () => {
    const catalogBroadcaster = await createCatalogBroadcaster();
    const regularBroadcaster = await createRegularBroadcaster();
    const order = await createTestOrder([
      makeOrderItem(catalogBroadcaster._id),
      makeOrderItem(regularBroadcaster._id),
    ]);

    const result = await processAutoApprovalForCatalogItems(order._id.toString());

    expect(result.allCatalog).toBe(false);
    expect(result.autoApproved).toBe(false);
    expect(result.catalogItems.length).toBeGreaterThan(0);
    expect(result.regularItems.length).toBeGreaterThan(0);

    // Status não deve ter mudado para approved
    const unchanged = await Order.findById(order._id);
    expect(unchanged!.status).toBe('paid');
  });

  it('pedido com item de broadcaster inexistente — tratado como regular', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const order = await createTestOrder([makeOrderItem(fakeId)]);

    const result = await processAutoApprovalForCatalogItems(order._id.toString());

    expect(result.allCatalog).toBe(false);
    expect(result.autoApproved).toBe(false);
  });
});
