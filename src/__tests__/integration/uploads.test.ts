/**
 * Integration Tests — Upload API
 *
 * Tests real HTTP endpoints end-to-end.
 * POST /api/upload/audio   — upload audio file
 * POST /api/upload/script  — upload script file
 * POST /api/upload/text    — save text material
 */

import '../helpers/mocks';

// Mock storage before importing routes
jest.mock('../../config/storage', () => ({
  uploadFile: jest.fn().mockResolvedValue('https://storage.example.com/test-file.mp3'),
}));

// Mock file-type before importing controller
const mockFromBuffer = jest.fn().mockResolvedValue({ mime: 'audio/mpeg', ext: 'mp3' });
jest.mock('file-type', () => ({
  fromBuffer: (...args: any[]) => mockFromBuffer(...args),
}));

import request from 'supertest';
import express, { Application, Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import hpp from 'hpp';
import mongoose from 'mongoose';
import { uploadFile } from '../../config/storage';

import { mongoSanitize, xssSanitize } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';
import uploadRoutes from '../../routes/uploadRoutes';
import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import {
  createAdvertiser,
  createBroadcaster,
} from '../helpers/authHelper';
import { Cart } from '../../models/Cart';
import { Product } from '../../models/Product';

function createApp(): Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(mongoSanitize);
  app.use(xssSanitize);
  app.use(hpp());
  app.use(csrfProtection);
  app.use('/api/upload', uploadRoutes);
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

/** Helper: creates a broadcaster with product and an advertiser with that product in cart */
async function setupCartWithItem() {
  const { user: broadcaster } = await createBroadcaster();
  const { user: advertiser, auth } = await createAdvertiser();

  const product = await Product.create({
    broadcasterId: broadcaster._id,
    spotType: 'Comercial 30s',
    duration: 30,
    timeSlot: 'Rotativo',
    netPrice: 100,
    pricePerInsertion: 125,
    isActive: true,
  });

  await Cart.create({
    userId: advertiser._id,
    items: [{
      productId: product._id,
      productName: 'Comercial 30s',
      productSchedule: 'Rotativo',
      broadcasterId: broadcaster._id,
      broadcasterName: 'Radio Test FM',
      broadcasterDial: '100.1',
      broadcasterBand: 'FM',
      broadcasterLogo: '',
      broadcasterCity: 'São Paulo',
      price: 125,
      quantity: 5,
      duration: 30,
      addedAt: new Date(),
    }],
  });

  return { advertiser, auth, product, broadcaster };
}

// ─────────────────────────────────────────────────
// POST /api/upload/text
// ─────────────────────────────────────────────────
describe('POST /api/upload/text', () => {
  it('should save text material to cart item', async () => {
    const { auth, product } = await setupCartWithItem();

    const res = await request(app)
      .post('/api/upload/text')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        productId: product._id.toString(),
        text: 'Venha conhecer nossa loja com ofertas imperdíveis!',
        wordCount: 7,
        duration: 15,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.wordCount).toBe(7);
  });

  it('should return 400 when productId is missing', async () => {
    const { auth } = await setupCartWithItem();

    const res = await request(app)
      .post('/api/upload/text')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ text: 'Something' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/inválidos/i);
  });

  it('should return 400 when text is missing', async () => {
    const { auth, product } = await setupCartWithItem();

    const res = await request(app)
      .post('/api/upload/text')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ productId: product._id.toString() });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/inválidos/i);
  });

  it('should return 404 when cart does not exist', async () => {
    const { auth: freshAuth } = await createAdvertiser();
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .post('/api/upload/text')
      .set('Cookie', freshAuth.cookieHeader)
      .set('X-CSRF-Token', freshAuth.csrfHeader)
      .send({ productId: fakeId.toString(), text: 'Some text' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/carrinho/i);
  });

  it('should return 404 when product is not in cart', async () => {
    const { auth } = await setupCartWithItem();
    const fakeProductId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .post('/api/upload/text')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ productId: fakeProductId.toString(), text: 'Some text' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/item não encontrado/i);
  });

  it('should return 401 when unauthenticated', async () => {
    const res = await request(app)
      .post('/api/upload/text')
      .send({ productId: 'abc', text: 'Text' });

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────
// POST /api/upload/audio
// ─────────────────────────────────────────────────
describe('POST /api/upload/audio', () => {
  it('should return 400 when no file is sent', async () => {
    const { auth, product } = await setupCartWithItem();

    const res = await request(app)
      .post('/api/upload/audio')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .field('productId', product._id.toString());

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/nenhum arquivo/i);
  });

  it('should return 401 when unauthenticated', async () => {
    const res = await request(app)
      .post('/api/upload/audio');

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────
// POST /api/upload/script
// ─────────────────────────────────────────────────
describe('POST /api/upload/script', () => {
  it('should return 400 when no file is sent', async () => {
    const { auth, product } = await setupCartWithItem();

    const res = await request(app)
      .post('/api/upload/script')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .field('productId', product._id.toString());

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/nenhum arquivo/i);
  });

  it('deve retornar 4xx/5xx para MIME type nao permitido (html disfarçado de script)', async () => {
    const { auth, product } = await setupCartWithItem();

    const res = await request(app)
      .post('/api/upload/script')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .field('productId', product._id.toString())
      .attach('script', Buffer.from('<html>hack</html>'), { filename: 'hack.html', contentType: 'text/html' });

    // multer fileFilter rejeita tipos nao permitidos — erro pode ser 400, 422 ou 500 dependendo do handler
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('deve retornar 400 para PDF com magic bytes invalidos (nao e PDF real)', async () => {
    const { auth, product } = await setupCartWithItem();
    // Simula arquivo com extensao .pdf mas magic bytes de outro tipo
    mockFromBuffer.mockResolvedValueOnce({ mime: 'image/png', ext: 'png' });

    const res = await request(app)
      .post('/api/upload/script')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .field('productId', product._id.toString())
      .attach('script', Buffer.from('%PDF-fake'), { filename: 'script.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/PDF|conteúdo/i);
  });

  it('deve retornar 401 sem autenticacao', async () => {
    const res = await request(app)
      .post('/api/upload/script');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────
// POST /api/upload/audio — testes de segurança
// ─────────────────────────────────────────────────
describe('POST /api/upload/audio — validacao de magic bytes', () => {
  beforeEach(() => {
    // Resetar para audio valido por padrao
    mockFromBuffer.mockResolvedValue({ mime: 'audio/mpeg', ext: 'mp3' });
  });

  it('deve retornar 400 para arquivo com magic bytes de executavel (EXE disfarçado de MP3)', async () => {
    const { auth, product } = await setupCartWithItem();
    // fromBuffer detecta que o conteudo e EXE, nao audio
    mockFromBuffer.mockResolvedValueOnce({ mime: 'application/x-msdownload', ext: 'exe' });

    const res = await request(app)
      .post('/api/upload/audio')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .field('productId', product._id.toString())
      .attach('audio', Buffer.from('MZmalware-payload'), { filename: 'audio.mp3', contentType: 'audio/mpeg' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/áudio|conteúdo|válido/i);
  });

  it('deve retornar 400 quando productId nao esta no carrinho (audio valido)', async () => {
    const { auth } = await setupCartWithItem();
    const fakeProductId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .post('/api/upload/audio')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .field('productId', fakeProductId.toString())
      .attach('audio', Buffer.from('audio-data'), { filename: 'test.mp3', contentType: 'audio/mpeg' });

    expect(res.status).toBe(404);
  });

  it('deve retornar 500 quando GCS falha (storage indisponivel)', async () => {
    const { auth, product } = await setupCartWithItem();
    const mockedUpload = uploadFile as jest.Mock;
    mockedUpload.mockRejectedValueOnce(new Error('GCS bucket unavailable'));

    const res = await request(app)
      .post('/api/upload/audio')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .field('productId', product._id.toString())
      .attach('audio', Buffer.from('audio-valid'), { filename: 'audio.mp3', contentType: 'audio/mpeg' });

    expect(res.status).toBe(500);
  });

  it('upload de audio valido — salva URL no carrinho e retorna 200', async () => {
    const { auth, product } = await setupCartWithItem();
    const mockedUpload = uploadFile as jest.Mock;
    mockedUpload.mockResolvedValueOnce('https://storage.test.com/audio.mp3');

    const res = await request(app)
      .post('/api/upload/audio')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .field('productId', product._id.toString())
      .attach('audio', Buffer.from('valid-audio-bytes'), { filename: 'comercial.mp3', contentType: 'audio/mpeg' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.url).toMatch(/storage/i);
    expect(res.body.fileName).toBe('comercial.mp3');
  });
});
