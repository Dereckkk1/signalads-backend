/**
 * Integration Tests — Visibilidade no marketplace (toggle "Exibir no marketplace")
 *
 * A emissora pode escolher se um item cadastrado aparece no marketplace, via o
 * campo `isActive`. Cobre:
 *   POST /api/products            (isActive no create → oculta da vitrine)
 *   POST /api/sponsorships        (isActive no create → oculta da vitrine)
 *   POST /api/broadcaster-combos  (isActive no create → combo inativo)
 *   GET  /api/products/my-products/export (planilha sem coluna "Preço Marketplace")
 */

import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';
import express from 'express';
import cookieParser from 'cookie-parser';
import ExcelJS from 'exceljs';

import { mongoSanitize, xssSanitize, dedupeQuery } from '../../middleware/security';
import { csrfProtection } from '../../middleware/csrf';
import productRoutes from '../../routes/productRoutes';
import sponsorshipRoutes from '../../routes/sponsorshipRoutes';
import broadcasterComboRoutes from '../../routes/broadcasterComboRoutes';

import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { createBroadcaster } from '../helpers/authHelper';
import { Product } from '../../models/Product';

function createVisibilityTestApp(): Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(mongoSanitize);
  app.use(xssSanitize);
  app.use(dedupeQuery);
  app.use(csrfProtection);
  app.use('/api/products', productRoutes);
  app.use('/api/sponsorships', sponsorshipRoutes);
  app.use('/api/broadcaster-combos', broadcasterComboRoutes);
  app.use((_req, res) => { res.status(404).json({ error: 'Rota não encontrada' }); });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.status || 500).json({ error: 'Erro interno do servidor' });
  });
  return app;
}

// Supertest não faz parse de binário por padrão — coleta o buffer bruto do XLSX.
function binaryParser(res: any, callback: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

const VALID_SPONSORSHIP = {
  programName: 'Show da Manhã',
  timeRange: { start: '08:00', end: '10:00' },
  daysOfWeek: [1, 2, 3, 4, 5],
  insertions: [{ name: 'Citação', duration: 0, quantityPerDay: 2, requiresMaterial: false }],
  netPrice: 500,
};

let app: Application;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret-key-for-testing-12345';
  process.env.NODE_ENV = 'test';
  await connectTestDB();
  app = createVisibilityTestApp();
});

afterEach(async () => {
  await clearTestDB();
});

afterAll(async () => {
  await disconnectTestDB();
});

// ─────────────────────────────────────────────────
// Inserções (Product)
// ─────────────────────────────────────────────────
describe('POST /api/products — visibilidade no marketplace', () => {
  it('cria inserção oculta (isActive:false) que não aparece no marketplace', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/products')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        name: 'Spot Especial',
        duration: 30,
        timeRange: { start: '06:00', end: '10:00' },
        netPrice: 200,
        isActive: false,
      });

    expect(res.status).toBe(201);
    expect(res.body.product.isActive).toBe(false);

    // O marketplace pagina por emissora; o item oculto não vem na lista de produtos ativos.
    const marketplace = await request(app).get('/api/products/marketplace');
    expect(marketplace.status).toBe(200);
    expect(marketplace.body.products).toHaveLength(0);
  });

  it('cria inserção visível por padrão quando isActive é omitido', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/products')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        name: 'Spot Padrão',
        duration: 30,
        timeRange: { start: '06:00', end: '10:00' },
        netPrice: 200,
      });

    expect(res.status).toBe(201);
    expect(res.body.product.isActive).toBe(true);

    const marketplace = await request(app).get('/api/products/marketplace');
    expect(marketplace.body.products.length).toBeGreaterThan(0);
    expect(marketplace.body.products.some((p: any) => p.name === 'Spot Padrão')).toBe(true);
  });

  it('propaga isActive:false para os produtos companheiros', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/products')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        spotType: 'Comercial 30s',
        timeSlot: 'Rotativo',
        netPrice: 100,
        isActive: false,
      });

    expect(res.status).toBe(201);
    expect(res.body.product.isActive).toBe(false);
    expect(res.body.companionsCreated.length).toBeGreaterThanOrEqual(1);
    for (const comp of res.body.companionsCreated) {
      expect(comp.isActive).toBe(false);
    }

    // Nem o produto pai nem os companheiros aparecem no marketplace.
    const marketplace = await request(app).get('/api/products/marketplace');
    expect(marketplace.body.products).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────
// Patrocínios (Sponsorship)
// ─────────────────────────────────────────────────
describe('POST /api/sponsorships — visibilidade no marketplace', () => {
  it('cria patrocínio oculto (isActive:false) que não aparece no marketplace', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/sponsorships')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ ...VALID_SPONSORSHIP, isActive: false });

    expect(res.status).toBe(201);
    expect(res.body.sponsorship.isActive).toBe(false);

    const marketplace = await request(app).get('/api/sponsorships/marketplace');
    expect(marketplace.status).toBe(200);
    expect(marketplace.body).toHaveLength(0);
  });

  it('cria patrocínio visível por padrão quando isActive é omitido', async () => {
    const { auth } = await createBroadcaster();

    const res = await request(app)
      .post('/api/sponsorships')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({ ...VALID_SPONSORSHIP });

    expect(res.status).toBe(201);
    expect(res.body.sponsorship.isActive).toBe(true);

    const marketplace = await request(app).get('/api/sponsorships/marketplace');
    expect(marketplace.body.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────
// Combos
// ─────────────────────────────────────────────────
describe('POST /api/broadcaster-combos — visibilidade', () => {
  it('respeita isActive:false no create do combo', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();

    const product = await Product.create({
      broadcasterId: broadcaster._id,
      spotType: 'Comercial 30s',
      duration: 30,
      timeSlot: 'Rotativo',
      netPrice: 100,
      pricePerInsertion: 125,
      isActive: true,
    });

    const res = await request(app)
      .post('/api/broadcaster-combos')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        name: 'Combo Oculto',
        items: [{ itemType: 'product', productId: product._id.toString(), defaultQuantity: 5 }],
        isActive: false,
      });

    expect(res.status).toBe(201);
    expect(res.body.combo.isActive).toBe(false);
  });

  it('cria combo ativo por padrão quando isActive é omitido', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();

    const product = await Product.create({
      broadcasterId: broadcaster._id,
      spotType: 'Comercial 30s',
      duration: 30,
      timeSlot: 'Rotativo',
      netPrice: 100,
      pricePerInsertion: 125,
      isActive: true,
    });

    const res = await request(app)
      .post('/api/broadcaster-combos')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .send({
        name: 'Combo Visível',
        items: [{ itemType: 'product', productId: product._id.toString(), defaultQuantity: 5 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.combo.isActive).toBe(true);
  });
});

// ─────────────────────────────────────────────────
// Exportação Excel — sem coluna de preço marketplace
// ─────────────────────────────────────────────────
describe('GET /api/products/my-products/export — sem preço marketplace', () => {
  it('não inclui a coluna "Preço Marketplace" na planilha', async () => {
    const { user: broadcaster, auth } = await createBroadcaster();

    await Product.create({
      broadcasterId: broadcaster._id,
      spotType: 'Comercial 30s',
      duration: 30,
      timeSlot: 'Rotativo',
      netPrice: 100,
      pricePerInsertion: 125,
      isActive: true,
    });

    const res = await request(app)
      .get('/api/products/my-products/export')
      .set('Cookie', auth.cookieHeader)
      .set('X-CSRF-Token', auth.csrfHeader)
      .buffer()
      .parse(binaryParser);

    expect(res.status).toBe(200);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body as any);
    const sheet = workbook.getWorksheet('Inserções');
    expect(sheet).toBeDefined();

    const headers = (sheet!.getRow(1).values as any[]).filter(Boolean).map(String);
    expect(headers).toContain('Preço Líquido (R$)');
    expect(headers.some((h) => /marketplace/i.test(h))).toBe(false);
  });
});
