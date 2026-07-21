/**
 * Integration Tests — Onboarding API (self-service broadcaster)
 *
 * Tests real HTTP endpoints end-to-end.
 * GET  /api/onboarding/progress
 * POST /api/onboarding/step
 * PUT  /api/onboarding/broadcaster/:id
 */

import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';

import { createTestApp } from '../helpers/createTestApp';
import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import {
  createBroadcaster,
  createAdvertiser,
} from '../helpers/authHelper';
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

describe('GET /api/onboarding/progress', () => {
  it('retorna broadcasterProfile e onboardingCompleted do proprio usuario', async () => {
    const { auth } = await createBroadcaster({
      onboardingCompleted: false,
      broadcasterProfile: {
        generalInfo: { stationName: 'Radio Progresso FM', dialFrequency: '88.5', band: 'FM' },
      },
    });

    const res = await request(app)
      .get('/api/onboarding/progress')
      .set('Cookie', auth.cookieHeader);

    expect(res.status).toBe(200);
    expect(res.body.broadcasterProfile.generalInfo.stationName).toBe('Radio Progresso FM');
    expect(res.body.onboardingCompleted).toBe(false);
  });

  it('retorna 401 sem autenticacao', async () => {
    const res = await request(app).get('/api/onboarding/progress');
    expect(res.status).toBe(401);
  });

  it('retorna 403 para nao-broadcaster (advertiser)', async () => {
    const { auth } = await createAdvertiser();
    const res = await request(app)
      .get('/api/onboarding/progress')
      .set('Cookie', auth.cookieHeader);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/onboarding/step', () => {
  it('etapa 1 normaliza stationName/dialFrequency/band em generalInfo e mantem logo no topo', async () => {
    const { user, auth } = await createBroadcaster({ onboardingCompleted: false, broadcasterProfile: {} });

    const res = await request(app)
      .post('/api/onboarding/step')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        step: 1,
        data: {
          stationName: 'Nova Radio FM',
          dialFrequency: '101.1',
          band: 'FM',
          logo: 'https://cdn.example.com/logo.png',
          comercialEmail: 'comercial@novaradio.com',
          website: 'https://novaradio.com',
          socialMedia: { instagram: '@novaradio' },
        },
      });

    expect(res.status).toBe(200);

    const saved = await User.findById(user._id).lean();
    expect((saved as any).broadcasterProfile.generalInfo.stationName).toBe('Nova Radio FM');
    expect((saved as any).broadcasterProfile.generalInfo.dialFrequency).toBe('101.1');
    expect((saved as any).broadcasterProfile.generalInfo.band).toBe('FM');
    expect((saved as any).broadcasterProfile.logo).toBe('https://cdn.example.com/logo.png');
    // etapa 1 NAO conclui o onboarding
    expect((saved as any).onboardingCompleted).toBe(false);
  });

  it('etapa 4 salva coverage e marca onboardingCompleted=true', async () => {
    const { user, auth } = await createBroadcaster({ onboardingCompleted: false, broadcasterProfile: {} });

    const res = await request(app)
      .post('/api/onboarding/step')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        step: 4,
        data: {
          coverage: {
            cities: ['São Paulo (0km)'],
            totalPopulation: 12000000,
            streamingUrl: 'https://stream.novaradio.com',
          },
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.onboardingCompleted).toBe(true);

    const saved = await User.findById(user._id).lean();
    expect((saved as any).broadcasterProfile.coverage.streamingUrl).toBe('https://stream.novaradio.com');
    expect((saved as any).onboardingCompleted).toBe(true);
  });

  it('retorna 400 para etapa invalida', async () => {
    const { auth } = await createBroadcaster({ onboardingCompleted: false });
    const res = await request(app)
      .post('/api/onboarding/step')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ step: 9, data: { foo: 'bar' } });
    expect(res.status).toBe(400);
  });

  it('retorna 401 sem autenticacao', async () => {
    const res = await request(app)
      .post('/api/onboarding/step')
      .set('X-CSRF-Token', 'x')
      .send({ step: 1, data: {} });
    expect(res.status).toBe(401);
  });

  it('retorna 403 para nao-broadcaster (advertiser)', async () => {
    const { auth } = await createAdvertiser();
    const res = await request(app)
      .post('/api/onboarding/step')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ step: 1, data: { stationName: 'X' } });
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/onboarding/broadcaster/:id', () => {
  it('atualiza o proprio perfil (companyName + broadcasterProfile)', async () => {
    const { user, auth } = await createBroadcaster({ onboardingCompleted: false });

    const res = await request(app)
      .put(`/api/onboarding/broadcaster/${user._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        name: 'Radio Renomeada FM',
        location: 'Campinas',
        profile: {
          generalInfo: { stationName: 'Radio Renomeada FM', dialFrequency: '95.7', band: 'FM' },
          categories: ['Jornalismo'],
        },
      });

    expect(res.status).toBe(200);

    const saved = await User.findById(user._id).lean();
    expect((saved as any).companyName).toBe('Radio Renomeada FM');
    expect((saved as any).broadcasterProfile.generalInfo.dialFrequency).toBe('95.7');
    expect((saved as any).broadcasterProfile.categories).toContain('Jornalismo');
  });

  it('SEGURANCA (5.4): emissora NAO consegue definir o proprio pmm nem sequestrar slug', async () => {
    const { user, auth } = await createBroadcaster({ onboardingCompleted: false });

    const res = await request(app)
      .put(`/api/onboarding/broadcaster/${user._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        profile: {
          categories: ['Musical'],
          // Campos administrativos: pmm ordena o marketplace (CPM) e slug e a
          // URL publica /emissora/:slug. Antes, o merge cego aceitava os dois.
          pmm: 999999,
          slug: 'radio-globo-sp',
        },
      });

    expect(res.status).toBe(200);

    const saved: any = await User.findById(user._id).lean();
    expect(saved.broadcasterProfile.pmm).not.toBe(999999);
    expect(saved.broadcasterProfile.slug).not.toBe('radio-globo-sp');
    // O campo legitimo do mesmo payload continua sendo aplicado
    expect(saved.broadcasterProfile.categories).toContain('Musical');
  });

  it('SEGURANCA (5.4): subcampo desconhecido nao e persistido', async () => {
    const { user, auth } = await createBroadcaster({ onboardingCompleted: false });

    await request(app)
      .put(`/api/onboarding/broadcaster/${user._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ profile: { campoInventado: 'x', categories: ['Esportes'] } });

    const saved: any = await User.findById(user._id).lean();
    expect(saved.broadcasterProfile.campoInventado).toBeUndefined();
    expect(saved.broadcasterProfile.categories).toContain('Esportes');
  });

  it('retorna 403 ao tentar atualizar o perfil de OUTRO usuario (IDOR)', async () => {
    const { auth } = await createBroadcaster({ onboardingCompleted: false });
    const { user: victim } = await createBroadcaster({ onboardingCompleted: false });

    const res = await request(app)
      .put(`/api/onboarding/broadcaster/${victim._id}`)
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ name: 'Hacker FM', profile: {} });

    expect(res.status).toBe(403);

    const saved = await User.findById(victim._id).lean();
    expect((saved as any).companyName).not.toBe('Hacker FM');
  });

  it('retorna 401 sem autenticacao', async () => {
    const { user } = await createBroadcaster();
    const res = await request(app)
      .put(`/api/onboarding/broadcaster/${user._id}`)
      .set('X-CSRF-Token', 'x')
      .send({ name: 'X', profile: {} });
    expect(res.status).toBe(401);
  });
});
