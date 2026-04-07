/**
 * Integration Tests — Image Proxy API
 *
 * Tests real HTTP endpoints end-to-end.
 * GET /api/image/proxy?fileName=...
 *
 * This controller has SSRF protections and an image caching proxy.
 * We test the validation logic (SSRF blocking, domain allowlist, etc.)
 * and mock axios for the actual fetch path.
 */

import '../helpers/mocks';

// Mock axios before importing routes
jest.mock('axios');

import request from 'supertest';
import express, { Application, Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import hpp from 'hpp';
import { PassThrough } from 'stream';

import { mongoSanitize, xssSanitize } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';
import imageRoutes from '../../routes/imageRoutes';
import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import axios from 'axios';

const mockedAxios = axios as jest.Mocked<typeof axios>;

function createApp(): Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(mongoSanitize);
  app.use(xssSanitize);
  app.use(hpp());
  app.use(csrfProtection);
  app.use('/api/image', imageRoutes);
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
  jest.clearAllMocks();
});

afterAll(async () => {
  await disconnectTestDB();
});

// ─────────────────────────────────────────────────
// GET /api/image/proxy — Validation tests
// ─────────────────────────────────────────────────
describe('GET /api/image/proxy', () => {
  it('should return 400 when fileName is missing', async () => {
    const res = await request(app).get('/api/image/proxy');

    expect(res.status).toBe(400);
    expect(res.text).toMatch(/fileName/i);
  });

  it('should redirect for allowed HTTPS AppSheet URLs', async () => {
    const url = 'https://www.appsheet.com/image/someimage.jpg';

    const res = await request(app)
      .get('/api/image/proxy')
      .query({ fileName: url });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(url);
  });

  it('should reject HTTP URLs (not HTTPS)', async () => {
    const res = await request(app)
      .get('/api/image/proxy')
      .query({ fileName: 'http://www.appsheet.com/image/test.jpg' });

    expect(res.status).toBe(403);
    expect(res.text).toMatch(/HTTPS/i);
  });

  it('should reject non-AppSheet domains (SSRF protection)', async () => {
    const res = await request(app)
      .get('/api/image/proxy')
      .query({ fileName: 'https://evil.com/malware.jpg' });

    expect(res.status).toBe(403);
    expect(res.text).toMatch(/domain/i);
  });

  it('should reject URLs pointing to internal IPs (SSRF protection)', async () => {
    const res = await request(app)
      .get('/api/image/proxy')
      .query({ fileName: 'https://127.0.0.1/internal.jpg' });

    // Either blocked by IP check or domain allowlist
    expect(res.status).toBe(403);
  });

  it('should reject URLs with localhost (SSRF protection)', async () => {
    const res = await request(app)
      .get('/api/image/proxy')
      .query({ fileName: 'https://localhost/attack.jpg' });

    expect(res.status).toBe(403);
  });

  it('should reject private network IPs (SSRF protection)', async () => {
    const res = await request(app)
      .get('/api/image/proxy')
      .query({ fileName: 'https://192.168.1.1/attack.jpg' });

    expect(res.status).toBe(403);
  });

  it('should fetch and stream image for valid non-URL fileName', async () => {
    // Use a unique fileName that won't exist in cache to force an axios fetch
    const uniqueFileName = `test_image_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;

    const stream = new PassThrough();
    // Emit data asynchronously
    process.nextTick(() => {
      stream.write(Buffer.from([0xff, 0xd8, 0xff])); // JPEG magic bytes
      stream.end();
    });

    (mockedAxios as unknown as jest.Mock).mockResolvedValueOnce({
      data: stream,
      headers: { 'content-type': 'image/jpeg' },
      status: 200,
      statusText: 'OK',
      config: {} as any,
    } as any);

    const res = await request(app)
      .get('/api/image/proxy')
      .query({ fileName: uniqueFileName });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image/);
    expect(mockedAxios).toHaveBeenCalledTimes(1);
  });
});
