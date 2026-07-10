/**
 * Integration Tests — Marketplace autocomplete
 * GET /api/products/marketplace/suggest?q=
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

describe('GET /api/products/marketplace/suggest', () => {
  it('sugere gênero, emissora e cidade por prefixo (case-insensitive)', async () => {
    await seedStation('Nativa', 'Joinville', 50, '103.1', 'Sertanejo');

    const res = await request(app).get('/api/products/marketplace/suggest?q=serta');
    expect(res.status).toBe(200);
    expect(res.body.genres[0].name).toBe('Sertanejo');
    expect(res.body.broadcasters).toEqual([]); // nenhuma emissora com "serta" no nome

    const res2 = await request(app).get('/api/products/marketplace/suggest?q=nati');
    expect(res2.status).toBe(200);
    expect(res2.body.broadcasters[0].stationName).toBe('Nativa');

    const res3 = await request(app).get('/api/products/marketplace/suggest?q=join');
    expect(res3.status).toBe(200);
    expect(res3.body.cities[0].city).toBe('Joinville');
    expect(res3.body.cities[0].count).toBe(1);
  });

  it('400 com q menor que 2 chars', async () => {
    const res = await request(app).get('/api/products/marketplace/suggest?q=a');
    expect(res.status).toBe(400);
  });
});
