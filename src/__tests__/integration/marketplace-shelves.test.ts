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
