/**
 * Integration Tests — Social proof (campanhas concluídas por emissora)
 * Service: campaignCountsByBroadcaster
 */

import '../helpers/mocks';

import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { createBroadcaster, createAdvertiser } from '../helpers/authHelper';
import Order from '../../models/Order';
import { campaignCountsByBroadcaster } from '../../services/socialProofService';

beforeAll(connectTestDB);
afterEach(clearTestDB);
afterAll(disconnectTestDB);

// items.broadcasterId é String no schema — sempre gravar como string.
const makeItem = (broadcasterId: any, overrides: any = {}) => ({
  productId: String(broadcasterId),
  productName: 'Spot',
  broadcasterName: 'X',
  broadcasterId: String(broadcasterId),
  quantity: 1,
  unitPrice: 10,
  totalPrice: 10,
  schedule: { '2026-07-15': 1 },
  ...overrides,
});

const makeOrder = (buyerId: any, status: string, n: number, items: any[]): any => {
  const gross = items.reduce((s, i) => s + i.totalPrice, 0);
  const total = Math.round(gross * 1.25);
  return {
    orderNumber: `ORD-SP-${String(n).padStart(4, '0')}`,
    buyerId,
    buyerName: 'Comprador Teste',
    buyerEmail: 'comprador@teste.com',
    buyerPhone: '11999999999',
    buyerDocument: '12345678000100',
    items,
    payment: {
      method: 'pending_contact',
      status: 'pending',
      chargedAmount: total,
      totalAmount: total,
      walletAmountUsed: 0,
    },
    splits: [],
    status,
    grossAmount: gross,
    broadcasterAmount: Math.round(gross * 0.75),
    platformSplit: Math.round(gross * 0.2),
    techFee: 5,
    totalAmount: total,
    subtotal: gross,
    platformFee: Math.round(gross * 0.25),
  };
};

describe('campaignCountsByBroadcaster', () => {
  it('conta pedidos completed por emissora (pedido conta 1x mesmo com 2 itens)', async () => {
    const b = await createBroadcaster();
    const { user: buyer } = await createAdvertiser();
    const item = makeItem(b.user._id);
    await Order.create(makeOrder(buyer._id, 'completed', 1, [item, item]));
    await Order.create(makeOrder(buyer._id, 'cancelled', 2, [item])); // não conta

    const counts = await campaignCountsByBroadcaster([b.user._id]);
    expect(counts[String(b.user._id)]).toBe(1);
  });

  it('conta pedidos distintos e separa por emissora', async () => {
    const a = await createBroadcaster({ companyName: 'A Radio' });
    const b = await createBroadcaster({ companyName: 'B Radio' });
    const { user: buyer } = await createAdvertiser();
    await Order.create(makeOrder(buyer._id, 'completed', 3, [makeItem(a.user._id)]));
    await Order.create(makeOrder(buyer._id, 'completed', 4, [makeItem(a.user._id)]));
    await Order.create(makeOrder(buyer._id, 'completed', 5, [makeItem(b.user._id)]));

    const counts = await campaignCountsByBroadcaster([a.user._id, b.user._id]);
    expect(counts[String(a.user._id)]).toBe(2);
    expect(counts[String(b.user._id)]).toBe(1);
  });

  it('emissora sem pedidos completed fica fora do mapa (front trata como 0)', async () => {
    const b = await createBroadcaster();
    const counts = await campaignCountsByBroadcaster([b.user._id]);
    expect(counts[String(b.user._id)]).toBeUndefined();
  });

  it('lista de ids vazia devolve mapa vazio sem consultar', async () => {
    const counts = await campaignCountsByBroadcaster([]);
    expect(counts).toEqual({});
  });
});
