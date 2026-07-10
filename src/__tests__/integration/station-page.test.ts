/**
 * Integration Tests — Página pública da emissora por slug
 * GET /api/products/marketplace/station/:slug
 */

import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';

import { createTestApp } from '../helpers/createTestApp';
import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { seedStation } from '../helpers/stationFactory';
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

describe('GET /api/products/marketplace/station/:slug', () => {
  it('devolve a emissora com produtos ativos (pricePerInsertion) e stats', async () => {
    const s = await seedStation('Radio Slug FM', 'Joinville', 90, '89.5', 'Sertanejo');
    await User.updateOne(
      { _id: s.user._id },
      { $set: { 'broadcasterProfile.slug': 'radio-slug-fm-joinville-89-5' } }
    );

    const res = await request(app).get(
      '/api/products/marketplace/station/radio-slug-fm-joinville-89-5'
    );

    expect(res.status).toBe(200);
    const station = res.body.station;
    expect(station).toBeTruthy();
    expect(station.stationName).toBe('Radio Slug FM');
    expect(station.slug).toBe('radio-slug-fm-joinville-89-5');
    expect(station.city).toBe('Joinville');
    expect(station.dialFrequency).toBe('89.5');
    expect(station.categories).toContain('Sertanejo');
    expect(station.minPrice).toBeCloseTo(80.44, 1);
    expect(Array.isArray(station.products)).toBe(true);
    expect(station.products.length).toBe(1);
    const p = station.products[0];
    expect(p.pricePerInsertion).toBeCloseTo(80.44, 1);
    expect(p.spotType).toBe('Comercial 30s');
    expect(p.timeSlot).toBe('06:00-12:00');
    // Campos agregados presentes
    expect(station).toHaveProperty('cpm');
    expect(station).toHaveProperty('campaignsCount');
    expect(station).toHaveProperty('earliestOnAir');
    expect(station).toHaveProperty('coverage');
    expect(station).toHaveProperty('generalInfo');
  });

  it('404 para slug inexistente', async () => {
    const res = await request(app).get(
      '/api/products/marketplace/station/nao-existe-slug'
    );
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Emissora não encontrada');
  });
});
