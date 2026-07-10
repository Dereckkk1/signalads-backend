/**
 * Integration Tests — Marketplace sort param
 * GET /api/products/marketplace?sort=menor_preco|maior_alcance|menor_cpm|az|relevancia
 */

import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';

import { createTestApp } from '../helpers/createTestApp';
import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { createBroadcaster } from '../helpers/authHelper';
import { Product } from '../../models/Product';

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

// Cria duas emissoras cujos sorts sejam distinguíveis entre si:
//  Zulu FM  → barata (netPrice 40 → 50), pop pequena (100k), pmm baixo (10)
//  Alpha FM → cara   (netPrice 400 → 500), pop grande (900k), pmm alto (90)
// menor_preco / menor_cpm → Zulu ; maior_alcance / az / relevancia → Alpha
async function seedTwoStations() {
  const zulu = await createBroadcaster({
    companyName: 'Zulu Radio',
    address: { cep: '89200000', city: 'Joinville', state: 'SC', latitude: -26.3, longitude: -48.84 },
    broadcasterProfile: {
      generalInfo: { stationName: 'Zulu FM', dialFrequency: '90.1', band: 'FM' },
      categories: ['Popular'],
      coverage: { states: ['SC'], cities: ['Joinville'], totalPopulation: 100000 },
      pmm: 10,
    },
  });
  const alpha = await createBroadcaster({
    companyName: 'Alpha Radio',
    address: { cep: '89200001', city: 'Joinville', state: 'SC', latitude: -26.3, longitude: -48.84 },
    broadcasterProfile: {
      generalInfo: { stationName: 'Alpha FM', dialFrequency: '99.9', band: 'FM' },
      categories: ['Hits'],
      coverage: { states: ['SC'], cities: ['Joinville'], totalPopulation: 900000 },
      pmm: 90,
    },
  });
  await Product.create({ broadcasterId: zulu.user._id, spotType: 'Comercial 30s', duration: 30, timeSlot: 'Rotativo', netPrice: 40, pricePerInsertion: 50, isActive: true });
  await Product.create({ broadcasterId: alpha.user._id, spotType: 'Comercial 30s', duration: 30, timeSlot: 'Rotativo', netPrice: 400, pricePerInsertion: 500, isActive: true });
  return { zulu, alpha };
}

const firstStationName = (res: any) =>
  res.body.products?.[0]?.broadcasterId?.broadcasterProfile?.generalInfo?.stationName;

describe('GET /api/products/marketplace?sort=', () => {
  it('menor_preco: emissora mais barata primeiro', async () => {
    await seedTwoStations();
    const res = await request(app).get('/api/products/marketplace?sort=menor_preco');
    expect(res.status).toBe(200);
    expect(firstStationName(res)).toBe('Zulu FM');
  });

  it('maior_alcance: maior totalPopulation primeiro', async () => {
    await seedTwoStations();
    const res = await request(app).get('/api/products/marketplace?sort=maior_alcance');
    expect(res.status).toBe(200);
    expect(firstStationName(res)).toBe('Alpha FM');
    expect(res.body.products[0].broadcasterId.broadcasterProfile.coverage.totalPopulation).toBe(900000);
  });

  it('menor_cpm: menor custo por mil primeiro', async () => {
    await seedTwoStations();
    const res = await request(app).get('/api/products/marketplace?sort=menor_cpm');
    expect(res.status).toBe(200);
    expect(firstStationName(res)).toBe('Zulu FM');
  });

  it('az: ordem alfabética por nome da emissora', async () => {
    await seedTwoStations();
    const res = await request(app).get('/api/products/marketplace?sort=az');
    expect(res.status).toBe(200);
    expect(firstStationName(res)).toBe('Alpha FM');
  });

  it('sort inválido cai no default (relevância/pmm) com status 200', async () => {
    await seedTwoStations();
    const res = await request(app).get('/api/products/marketplace?sort=banana');
    expect(res.status).toBe(200);
    // default ordena por pmm desc → Alpha (pmm 90) primeiro
    expect(firstStationName(res)).toBe('Alpha FM');
  });

  it('anexa social proof (campaignsCount) e earliestOnAir em cada produto', async () => {
    await seedTwoStations();
    const res = await request(app).get('/api/products/marketplace');
    expect(res.status).toBe(200);
    expect(res.body.products.length).toBeGreaterThan(0);
    expect(res.body.products[0]).toHaveProperty('campaignsCount');
    expect(res.body.products[0].campaignsCount).toBe(0); // nenhum pedido completed no seed
    expect(res.body.products[0]).toHaveProperty('earliestOnAir');
    expect(res.body.products[0].earliestOnAir).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
