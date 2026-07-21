/**
 * Integration Tests — Origin protection em rotas CSRF-isentas + redirect do proxy de imagem
 *
 * FASE 6.3 — /api/auth/login, /api/auth/register, /api/auth/2fa/confirm e
 *            /api/contact-messages sao isentos de CSRF (double-submit cookie) mas
 *            PRECISAM validar o header Origin/Referer, senao ficam abertos a
 *            login-CSRF e spam cross-site.
 *
 * FASE 6.4 — /api/image/proxy nao pode redirecionar para a string crua enviada
 *            pelo cliente; a URL de destino e reconstruida a partir do
 *            hostname/pathname/search ja validados.
 */

import '../helpers/mocks';

jest.mock('axios');

import request from 'supertest';
import express, { Application, Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';

import { csrfProtection } from '../../middleware/csrf';
import imageRoutes from '../../routes/imageRoutes';

const ORIGIN_PROTECTED = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/2fa/confirm',
  '/api/contact-messages',
];

/**
 * App minimo: apenas o csrfProtection + um handler-stub que ecoa 200.
 * Isola a decisao do middleware (403 x passa adiante) das regras de negocio
 * de cada controller.
 */
function createMiddlewareApp(): Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use(csrfProtection);
  app.use((_req: Request, res: Response) => {
    res.status(200).json({ ok: true });
  });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.status || 500).json({ error: 'Erro interno do servidor' });
  });
  return app;
}

function createImageApp(): Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/api/image', imageRoutes);
  return app;
}

let app: Application;
let imageApp: Application;

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-key-for-testing-12345';
  process.env.NODE_ENV = 'test';
  app = createMiddlewareApp();
  imageApp = createImageApp();
});

// ─────────────────────────────────────────────────
// 6.3 — Origin obrigatorio nas rotas CSRF-isentas
// ─────────────────────────────────────────────────
describe('csrfProtection — Origin em rotas isentas de CSRF', () => {
  describe.each(ORIGIN_PROTECTED)('%s', (route) => {
    it('bloqueia POST com Origin de terceiro (403)', async () => {
      const res = await request(app)
        .post(route)
        .set('Origin', 'https://atacante.example')
        .send({ email: 'a@b.com', password: 'x' });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/origem/i);
    });

    it('bloqueia POST cujo Referer e de terceiro (403)', async () => {
      const res = await request(app)
        .post(route)
        .set('Referer', 'https://atacante.example/pagina')
        .send({ email: 'a@b.com', password: 'x' });

      expect(res.status).toBe(403);
    });

    it('aceita POST com Origin permitido', async () => {
      const res = await request(app)
        .post(route)
        .set('Origin', 'https://eradios.com.br')
        .send({ email: 'a@b.com', password: 'x' });

      expect(res.status).toBe(200);
    });

    it('aceita POST sem Origin nem Referer (server-to-server / curl)', async () => {
      const res = await request(app).post(route).send({ email: 'a@b.com', password: 'x' });

      expect(res.status).toBe(200);
    });
  });

  it('/api/auth/refresh continua protegido por Origin', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Origin', 'https://atacante.example')
      .send({});

    expect(res.status).toBe(403);
  });

  it('nao bloqueia GET com Origin de terceiro (metodo seguro)', async () => {
    const res = await request(app)
      .get('/api/auth/login')
      .set('Origin', 'https://atacante.example');

    expect(res.status).toBe(200);
  });

  it('/api/vitals segue isento tambem de Origin (sendBeacon)', async () => {
    const res = await request(app)
      .post('/api/vitals')
      .set('Origin', 'https://atacante.example')
      .send({ name: 'LCP', value: 1 });

    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────
// 6.4 — Redirect reconstruido no proxy de imagem
// ─────────────────────────────────────────────────
describe('GET /api/image/proxy — redirect reconstruido', () => {
  it('descarta credenciais embutidas na URL (user:pass@)', async () => {
    const res = await request(imageApp)
      .get('/api/image/proxy')
      .query({ fileName: 'https://user:senha@www.appsheet.com/image/foto.jpg' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://www.appsheet.com/image/foto.jpg');
    expect(res.headers.location).not.toContain('senha');
  });

  it('descarta o fragmento (#) da URL fornecida', async () => {
    const res = await request(imageApp)
      .get('/api/image/proxy')
      .query({ fileName: 'https://www.appsheet.com/image/foto.jpg#@evil.example' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://www.appsheet.com/image/foto.jpg');
  });

  it('preserva pathname e query da URL validada', async () => {
    const res = await request(imageApp)
      .get('/api/image/proxy')
      .query({ fileName: 'https://www.appsheet.com/image/getimageurl?appName=X&fileName=Y' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://www.appsheet.com/image/getimageurl?appName=X&fileName=Y');
  });

  it('continua bloqueando dominio fora da allowlist', async () => {
    const res = await request(imageApp)
      .get('/api/image/proxy')
      .query({ fileName: 'https://evil.example/malware.jpg' });

    expect(res.status).toBe(403);
  });
});
