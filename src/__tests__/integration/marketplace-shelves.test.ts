/**
 * Integration Tests — Marketplace shelves + similar
 * GET /api/products/marketplace/shelves?city=&state=
 * GET /api/products/marketplace/similar?ids=
 */

import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';

import { createTestApp } from '../helpers/createTestApp';
import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { seedStation } from '../helpers/stationFactory';
import { User } from '../../models/User';

// Coordenadas reais para os testes de proximidade das regiões
const COORDS: Record<string, [number, number]> = {
  Joinville: [-26.3, -48.85],
  Blumenau: [-26.92, -49.07],
  Curitiba: [-25.43, -49.27],
};
async function setStationCoords(userId: any, city: keyof typeof COORDS) {
  const [latitude, longitude] = COORDS[city];
  await User.updateOne({ _id: userId }, { $set: { 'address.latitude': latitude, 'address.longitude': longitude } });
}

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

describe('GET /api/products/marketplace/shelves', () => {
  it('devolve líderes da cidade ordenados por pmm desc + dial por frequência', async () => {
    await seedStation('Lider FM', 'Joinville', 90, '89.5');
    await seedStation('Vice FM', 'Joinville', 50, '99.1');
    await seedStation('Outra FM', 'Blumenau', 99, '102.7'); // fora da cidade

    const res = await request(app).get('/api/products/marketplace/shelves?city=Joinville&state=SC');
    expect(res.status).toBe(200);
    expect(res.body.leaders.map((l: any) => l.stationName)).toEqual(['Lider FM', 'Vice FM']);
    expect(res.body.leaders[0].minPrice).toBeCloseTo(80.44, 1);
    expect(res.body.dial.map((d: any) => d.dialFrequency)).toEqual(['89.5', '99.1']);
    expect(res.body.fallback).toBe('city');
  });

  it('inclui audienceProfile no card do líder quando a emissora preencheu', async () => {
    await seedStation('Perfil FM', 'Joinville', 90, '89.5', 'Hits', 'SC', {
      gender: { male: 58, female: 42 },
      ageRange: '30+ anos',
      socialClass: { classeAB: 22, classeC: 55, classeDE: 23 },
    });

    const res = await request(app).get('/api/products/marketplace/shelves?city=Joinville&state=SC');
    expect(res.status).toBe(200);
    const card = res.body.leaders.find((l: any) => l.stationName === 'Perfil FM');
    expect(card.audienceProfile).toMatchObject({
      gender: { male: 58, female: 42 },
      ageRange: '30+ anos',
      socialClass: { classeAB: 22, classeC: 55, classeDE: 23 },
    });
  });

  it('audienceProfile é null quando a emissora não preencheu', async () => {
    await seedStation('Sem Perfil FM', 'Joinville', 90, '89.5');
    const res = await request(app).get('/api/products/marketplace/shelves?city=Joinville&state=SC');
    expect(res.status).toBe(200);
    expect(res.body.leaders[0].audienceProfile).toBeNull();
  });

  it('cidade sem emissoras devolve leaders do estado como fallback', async () => {
    await seedStation('Estadual FM', 'Blumenau', 70, '102.7');
    const res = await request(app).get('/api/products/marketplace/shelves?city=Nowhere&state=SC');
    expect(res.status).toBe(200);
    expect(res.body.leaders[0].stationName).toBe('Estadual FM');
    expect(res.body.fallback).toBe('state');
  });

  it('400 sem city e sem state', async () => {
    const res = await request(app).get('/api/products/marketplace/shelves');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/products/marketplace/similar', () => {
  it('sugere emissora da mesma categoria/estado excluindo as vistas', async () => {
    const seen = await seedStation('Vista FM', 'Joinville', 90, '89.5', 'Sertanejo');
    await seedStation('Sugerida FM', 'Blumenau', 60, '103.5', 'Sertanejo');
    const res = await request(app).get(`/api/products/marketplace/similar?ids=${seen.user._id}`);
    expect(res.status).toBe(200);
    expect(res.body.items[0].stationName).toBe('Sugerida FM');
    expect(res.body.items[0].reason.refName).toBe('Vista FM');
  });

  it('400 com ids inválidos', async () => {
    const res = await request(app).get('/api/products/marketplace/similar?ids=nao-e-objectid');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/products/marketplace/regions', () => {
  it('lista cidades com estado e contagem, ordenadas por contagem desc', async () => {
    await seedStation('A FM', 'Joinville', 90, '89.5');
    await seedStation('B FM', 'Joinville', 50, '99.1');
    await seedStation('C FM', 'Blumenau', 70, '101.1');

    const res = await request(app).get('/api/products/marketplace/regions');
    expect(res.status).toBe(200);
    expect(res.body.regions[0]).toEqual({ city: 'Joinville', state: 'SC', count: 2 });
    expect(res.body.regions.map((r: any) => r.city)).toContain('Blumenau');
  });

  it('devolve lista vazia sem emissoras', async () => {
    const res = await request(app).get('/api/products/marketplace/regions');
    expect(res.status).toBe(200);
    expect(res.body.regions).toEqual([]);
  });

  it('com lat/lng ordena pela cidade com emissora mais próxima (vence a contagem)', async () => {
    // Joinville tem 2 emissoras (líder por contagem); Curitiba tem 1.
    const ja = await seedStation('A FM', 'Joinville', 90, '89.5', 'Hits', 'SC');
    const jb = await seedStation('B FM', 'Joinville', 50, '99.1', 'Hits', 'SC');
    const cc = await seedStation('C FM', 'Curitiba', 70, '101.1', 'Hits', 'PR');
    await setStationCoords(ja.user._id, 'Joinville');
    await setStationCoords(jb.user._id, 'Joinville');
    await setStationCoords(cc.user._id, 'Curitiba');

    // Ponto perto de Curitiba, mas numa cidade SEM emissora (Ponta Grossa).
    const res = await request(app).get('/api/products/marketplace/regions?lat=-25.09&lng=-50.16');
    expect(res.status).toBe(200);
    // Curitiba (mais perto) vem antes de Joinville, apesar de Joinville ter mais emissoras.
    expect(res.body.regions[0]).toEqual({ city: 'Curitiba', state: 'PR', count: 1 });
    expect(res.body.regions.map((r: any) => r.city)).toEqual(['Curitiba', 'Joinville']);
  });

  it('sem lat/lng mantém ordenação por contagem desc', async () => {
    const ja = await seedStation('A FM', 'Joinville', 90, '89.5', 'Hits', 'SC');
    const jb = await seedStation('B FM', 'Joinville', 50, '99.1', 'Hits', 'SC');
    const cc = await seedStation('C FM', 'Curitiba', 70, '101.1', 'Hits', 'PR');
    await setStationCoords(ja.user._id, 'Joinville');
    await setStationCoords(jb.user._id, 'Joinville');
    await setStationCoords(cc.user._id, 'Curitiba');

    const res = await request(app).get('/api/products/marketplace/regions');
    expect(res.status).toBe(200);
    expect(res.body.regions[0]).toEqual({ city: 'Joinville', state: 'SC', count: 2 });
  });

  it('coords inválidas caem no comportamento por contagem (não quebram)', async () => {
    await seedStation('A FM', 'Joinville', 90, '89.5', 'Hits', 'SC');
    const res = await request(app).get('/api/products/marketplace/regions?lat=abc&lng=xyz');
    expect(res.status).toBe(200);
    expect(res.body.regions[0]).toEqual({ city: 'Joinville', state: 'SC', count: 1 });
  });
});

describe('GET /api/products/marketplace/by-genre', () => {
  it('devolve emissoras do gênero priorizando a cidade da região', async () => {
    await seedStation('Sert Joinville', 'Joinville', 40, '88.1', 'Sertanejo');
    await seedStation('Sert Blumenau', 'Blumenau', 90, '95.3', 'Sertanejo');
    await seedStation('Hits FM', 'Joinville', 99, '100.1', 'Hits'); // outro gênero

    const res = await request(app).get('/api/products/marketplace/by-genre?genre=Sertanejo&city=Joinville&state=SC');
    expect(res.status).toBe(200);
    expect(res.body.genre).toBe('Sertanejo');
    const names = res.body.items.map((i: any) => i.stationName);
    expect(names).toEqual(['Sert Joinville', 'Sert Blumenau']); // cidade da região primeiro
    expect(names).not.toContain('Hits FM');
  });

  it('sem genre devolve lista vazia', async () => {
    const res = await request(app).get('/api/products/marketplace/by-genre');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ genre: null, items: [] });
  });

  it('filtra por estado quando informado', async () => {
    await seedStation('SC Sert', 'Joinville', 50, '88.1', 'Sertanejo', 'SC');
    await seedStation('PR Sert', 'Curitiba', 80, '91.3', 'Sertanejo', 'PR');

    const res = await request(app).get('/api/products/marketplace/by-genre?genre=Sertanejo&state=SC');
    expect(res.status).toBe(200);
    const names = res.body.items.map((i: any) => i.stationName);
    expect(names).toContain('SC Sert');
    expect(names).not.toContain('PR Sert');
  });
});

describe('GET /api/products/marketplace/by-ids', () => {
  it('devolve cards completos preservando a ordem dos ids (recência)', async () => {
    const a = await seedStation('Alpha FM', 'Joinville', 90, '89.5', 'Hits', 'SC', {
      gender: { male: 58, female: 42 },
      ageRange: '30+ anos',
      socialClass: { classeAB: 22, classeC: 55, classeDE: 23 },
    });
    const b = await seedStation('Beta FM', 'Blumenau', 50, '99.1');

    // ids na ordem [Beta, Alpha] → resposta deve respeitar essa ordem (mais recente primeiro)
    const res = await request(app).get(`/api/products/marketplace/by-ids?ids=${b.user._id},${a.user._id}`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: any) => i.stationName)).toEqual(['Beta FM', 'Alpha FM']);
    // card com a mesma anatomia das demais shelves (KPIs + perfil de audiência)
    const alpha = res.body.items.find((i: any) => i.stationName === 'Alpha FM');
    expect(alpha.totalPopulation).toBeGreaterThan(0);
    expect(alpha.minPrice).toBeGreaterThan(0);
    expect(alpha.audienceProfile).toMatchObject({ gender: { male: 58, female: 42 } });
  });

  it('ignora ids desconhecidos e retorna só emissoras compráveis', async () => {
    const a = await seedStation('Alpha FM', 'Joinville', 90, '89.5');
    const ghost = '507f1f77bcf86cd799439011'; // ObjectId válido, inexistente

    const res = await request(app).get(`/api/products/marketplace/by-ids?ids=${ghost},${a.user._id}`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: any) => i.stationName)).toEqual(['Alpha FM']);
  });

  it('400 com ids inválidos', async () => {
    const res = await request(app).get('/api/products/marketplace/by-ids?ids=nao-e-objectid');
    expect(res.status).toBe(400);
  });

  it('400 sem ids', async () => {
    const res = await request(app).get('/api/products/marketplace/by-ids');
    expect(res.status).toBe(400);
  });
});
