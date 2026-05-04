/**
 * Integration Tests — Suspicious Path Auto-Block
 *
 * Verifica end-to-end que requests para paths conhecidos de exploit
 * sao bloqueados na primeira tentativa, persistidos em BlockedIP e
 * que paths legitimos passam normalmente.
 */

import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';

import { createTestApp } from '../helpers/createTestApp';
import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { blockedIPsSet } from '../../utils/ipBlockList';
import BlockedIP from '../../models/BlockedIP';

let app: Application;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret-key-for-testing-12345';
  process.env.NODE_ENV = 'test';
  await connectTestDB();
  app = createTestApp();
});

afterEach(async () => {
  await clearTestDB();
  blockedIPsSet.clear();
});

afterAll(async () => {
  await disconnectTestDB();
});

describe('Suspicious path — bloqueio na primeira tentativa', () => {
  // Supertest manda de localhost por padrao, e localhost e isento.
  // Precisamos forjar um IP via X-Forwarded-For + trust proxy nao esta ativo
  // no test app. Validamos comportamento de localhost (404 sem persistir)
  // e usamos teste unitario para cobrir IP nao-localhost.

  it('GET /.env retorna 404', async () => {
    const res = await request(app).get('/.env');
    expect(res.status).toBe(404);
  });

  it('GET /wordpress/.env retorna 404', async () => {
    const res = await request(app).get('/wordpress/.env');
    expect(res.status).toBe(404);
  });

  it('GET /storage/.env retorna 404', async () => {
    const res = await request(app).get('/storage/.env');
    expect(res.status).toBe(404);
  });

  it('GET /wp-admin retorna 404', async () => {
    const res = await request(app).get('/wp-admin');
    expect(res.status).toBe(404);
  });

  it('GET /phpmyadmin retorna 404', async () => {
    const res = await request(app).get('/phpmyadmin');
    expect(res.status).toBe(404);
  });

  it('GET /.git/config retorna 404', async () => {
    const res = await request(app).get('/.git/config');
    expect(res.status).toBe(404);
  });

  it('GET /xmlrpc.php retorna 404', async () => {
    const res = await request(app).get('/xmlrpc.php');
    expect(res.status).toBe(404);
  });

  it('GET /shell.php retorna 404', async () => {
    const res = await request(app).get('/shell.php');
    expect(res.status).toBe(404);
  });

  it('localhost nao e adicionado ao blockedIPsSet', async () => {
    await request(app).get('/.env');
    // Localhost (::ffff:127.0.0.1 ou ::1) nao deve ser bloqueado
    const localhostBlocked = ['::1', '127.0.0.1', '::ffff:127.0.0.1'].some((ip) =>
      blockedIPsSet.has(ip)
    );
    expect(localhostBlocked).toBe(false);

    const persisted = await BlockedIP.findOne({});
    expect(persisted).toBeNull();
  });
});

describe('Suspicious path — paths legitimos passam', () => {
  it('GET /api/auth/me retorna 401 (auth normal, nao bloqueado)', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('GET / retorna 200', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
  });

  it('GET /api/products retorna 401 (auth normal)', async () => {
    const res = await request(app).get('/api/products/my-products');
    expect(res.status).toBe(401);
  });
});
