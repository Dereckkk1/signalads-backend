/**
 * Integration Tests — Marketplace proximidade por cidade pesquisada
 * GET /api/products/marketplace?nearCity=&nearState=
 *
 * Verifica que a lista é ancorada na REGIÃO pesquisada (não na cidade do usuário
 * logado), que o gate roda mesmo com filtro de cidade, e a flag isSortedByProximity.
 */

import '../helpers/mocks';

// Mock do geocoder: cidade → coordenada fixa (evita rede/Nominatim nos testes).
jest.mock('node-geocoder', () => {
  return jest.fn(() => ({
    geocode: jest.fn(async (query: string) => {
      const q = String(query).toLowerCase();
      if (q.includes('sao paulo') || q.includes('são paulo')) return [{ latitude: -23.55, longitude: -46.63 }];
      if (q.includes('recife')) return [{ latitude: -8.05, longitude: -34.9 }];
      if (q.includes('campinas')) return [{ latitude: -22.9, longitude: -47.06 }];
      return [];
    }),
    reverse: jest.fn(async () => []),
  }));
});

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

// 3 emissoras em cidades a distâncias bem distintas; mesmo pmm para isolar a distância.
async function seedThreeCities() {
  const mk = async (companyName: string, stationName: string, city: string, state: string, latitude: number, longitude: number) => {
    const b = await createBroadcaster({
      companyName,
      address: { cep: '00000000', city, state, latitude, longitude },
      broadcasterProfile: {
        generalInfo: { stationName, dialFrequency: '90.1', band: 'FM' },
        categories: ['Pop'],
        coverage: { states: [state], cities: [city], totalPopulation: 500000 },
        pmm: 50,
      },
    });
    await Product.create({ broadcasterId: b.user._id, spotType: 'Comercial 30s', duration: 30, timeSlot: 'Rotativo', netPrice: 100, pricePerInsertion: 125, isActive: true });
    return b;
  };
  const sp = await mk('SP Radio', 'SP FM', 'São Paulo', 'SP', -23.55, -46.63);
  const campinas = await mk('Campinas Radio', 'Campinas FM', 'Campinas', 'SP', -22.9, -47.06);
  const recife = await mk('Recife Radio', 'Recife FM', 'Recife', 'PE', -8.05, -34.9);
  return { sp, campinas, recife };
}

const orderedNames = (res: any): string[] =>
  (res.body.products || []).map((p: any) => p.broadcasterId?.broadcasterProfile?.generalInfo?.stationName);

describe('GET /api/products/marketplace — proximidade por cidade pesquisada', () => {
  it('ancora na cidade pesquisada: emissora da cidade primeiro, a mais distante por último', async () => {
    await seedThreeCities();
    const res = await request(app)
      .get('/api/products/marketplace')
      .query({ nearCity: 'São Paulo', nearState: 'SP' });

    expect(res.status).toBe(200);
    expect(res.body.isSortedByProximity).toBe(true);
    expect(res.body.proximityCity).toBe('São Paulo');

    const names = orderedNames(res);
    expect(names[0]).toBe('SP FM'); // mesma cidade da âncora vem no topo
    expect(names[names.length - 1]).toBe('Recife FM'); // ~2100km → por último
  });

  it('troca a âncora: nearCity=Recife coloca a emissora de Recife primeiro', async () => {
    await seedThreeCities();
    const res = await request(app)
      .get('/api/products/marketplace')
      .query({ nearCity: 'Recife', nearState: 'PE' });

    expect(res.status).toBe(200);
    expect(res.body.isSortedByProximity).toBe(true);
    expect(orderedNames(res)[0]).toBe('Recife FM');
  });

  it('sem nearCity e sem login: não ordena por proximidade (isSortedByProximity=false)', async () => {
    await seedThreeCities();
    const res = await request(app).get('/api/products/marketplace');

    expect(res.status).toBe(200);
    expect(res.body.isSortedByProximity).toBe(false);
    expect(res.body.proximityCity).toBeNull();
  });

  it('proximidade roda mesmo com filtro de cidade (gate liberado pela âncora)', async () => {
    await seedThreeCities();
    const res = await request(app)
      .get('/api/products/marketplace')
      .query({ nearCity: 'São Paulo', nearState: 'SP', city: 'São Paulo' });

    expect(res.status).toBe(200);
    expect(res.body.isSortedByProximity).toBe(true);
    const names = orderedNames(res);
    expect(names).toContain('SP FM');
    expect(names).not.toContain('Recife FM'); // filtro de cidade restringe a São Paulo
  });
});
