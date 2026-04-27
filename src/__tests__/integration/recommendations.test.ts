/**
 * Integration Tests — Recommendations API
 *
 * Tests real HTTP endpoints end-to-end.
 * POST /api/recommendations/plan  (authenticated, AI-powered)
 */

import '../helpers/mocks';

// Mock the AIService module
jest.mock('../../services/AIService', () => {
  const mockResolveLocation = jest.fn().mockResolvedValue({
    cities: ['São Paulo'],
    states: ['SP'],
  });

  const mockBuildMediaPlan = jest.fn().mockResolvedValue({
    items: [
      {
        id: 'mock-broadcaster-id',
        name: 'Radio Test FM',
        city: 'São Paulo',
        state: 'SP',
        price: 125,
        quantity: 10,
        totalCost: 1250,
      },
    ],
    totalCost: 1250,
    totalSpots: 10,
    totalBroadcasters: 1,
    analysis: 'Plano recomendado para sua campanha.',
  });

  return {
    AIService: jest.fn().mockImplementation(() => ({
      resolveLocation: mockResolveLocation,
      buildMediaPlan: mockBuildMediaPlan,
    })),
    __mockResolveLocation: mockResolveLocation,
    __mockBuildMediaPlan: mockBuildMediaPlan,
  };
});

import request from 'supertest';
import express, { Application, Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';

import { mongoSanitize, xssSanitize, dedupeQuery } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';
import recommendationRoutes from '../../routes/recommendationRoutes';
import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import {
  createAdvertiser,
  createBroadcaster,
} from '../helpers/authHelper';
import { Product } from '../../models/Product';

function createApp(): Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(mongoSanitize);
  app.use(xssSanitize);
  app.use(dedupeQuery);
  app.use(csrfProtection);
  app.use('/api/recommendations', recommendationRoutes);
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Rota não encontrada' });
  });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.status || 500).json({ error: 'Erro interno do servidor' });
  });
  return app;
}

let app: Application;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret-key-for-testing-12345';
  process.env.NODE_ENV = 'test';
  await connectTestDB();
  app = createApp();
});

afterEach(async () => {
  await clearTestDB();
});

afterAll(async () => {
  await disconnectTestDB();
});

// ─────────────────────────────────────────────────
// POST /api/recommendations/plan
// ─────────────────────────────────────────────────
describe('POST /api/recommendations/plan', () => {
  it('should return a media plan when broadcasters are found', async () => {
    // Create a broadcaster in SP with a product
    const { user: broadcaster } = await createBroadcaster({
      address: {
        city: 'São Paulo',
        state: 'SP',
        cep: '01001000',
        street: 'Rua Teste',
        number: '100',
        neighborhood: 'Centro',
        latitude: -23.55,
        longitude: -46.63,
      },
    });

    await Product.create({
      broadcasterId: broadcaster._id,
      spotType: 'Comercial 30s',
      duration: 30,
      timeSlot: 'Rotativo',
      pricePerInsertion: 125,
      isActive: true,
    });

    const { auth } = await createAdvertiser();

    const res = await request(app)
      .post('/api/recommendations/plan')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        businessDescription: 'Loja de roupas no centro de SP',
        location: 'São Paulo',
        budget: 5000,
        targetAudience: ['jovem', 'classe a/b'],
      });

    expect(res.status).toBe(200);
    expect(res.body.items).toBeDefined();
    expect(res.body.totalCost).toBeDefined();
    expect(res.body.totalBroadcasters).toBeDefined();
  });

  it('should return empty plan when no broadcasters found', async () => {
    const { auth } = await createAdvertiser();

    // No broadcasters exist — resolveLocation returns cities but no matches in DB

    const res = await request(app)
      .post('/api/recommendations/plan')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        businessDescription: 'Restaurante no interior',
        location: 'Cidade Inexistente',
        budget: 3000,
      });

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.totalBroadcasters).toBe(0);
  });

  it('should return 400 when required fields are missing', async () => {
    const { auth } = await createAdvertiser();

    const res = await request(app)
      .post('/api/recommendations/plan')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ businessDescription: 'Test' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/missing required/i);
  });

  it('should return 401 when unauthenticated', async () => {
    const res = await request(app)
      .post('/api/recommendations/plan')
      .send({
        businessDescription: 'Test',
        location: 'SP',
        budget: 1000,
      });

    expect(res.status).toBe(401);
  });
});
