/**
 * Unit Tests — rateLimitStore (item 4.1 do plano 2026-07-20, severidade CRITICA)
 *
 * NAO importa `../helpers/mocks`: o helper global stuba `config/rateLimitStore`
 * inteiro, o que impediria exercitar justamente o codigo sob teste.
 *
 * O bug corrigido: quando o Redis falhava, `sendCommand` devolvia `[1, 0]`
 * sintetico — "1 hit, longe do limite" — em TODA chamada. Como todos os
 * limiters (login, 2FA, register, checkout, webhook) usam este store, uma
 * queda do Redis desligava silenciosamente a protecao contra brute force do
 * produto inteiro. Hoje degrada para contagem em memoria do processo.
 */

// ioredis nao pode abrir conexao real durante o teste.
jest.mock('../../../config/redis', () => ({
  redis: { call: jest.fn(), status: 'end' },
  getRedisHealth: jest.fn(),
  cacheGet: jest.fn(),
  cacheSet: jest.fn(),
}));

import { createRedisStore, __resetDegradedCounters } from '../../../config/rateLimitStore';
import { redis } from '../../../config/redis';

/** Store com o Redis simulado como indisponivel. */
function degradedStore(prefix: string) {
  (redis as any).call.mockRejectedValue(new Error('ECONNREFUSED'));
  const store: any = createRedisStore(prefix);
  store.init({ windowMs: 60_000 });
  return store;
}

beforeEach(() => {
  __resetDegradedCounters();
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('createRedisStore — degradacao quando o Redis cai', () => {
  it('SEGURANCA: a contagem SOBE a cada chamada (nao falha aberto)', async () => {
    const store = degradedStore('deg-1');

    const hits: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await store.increment('chave-x');
      hits.push(r.totalHits);
    }

    expect(hits).toEqual([1, 2, 3, 4, 5]);
  });

  it('SEGURANCA: um limite de 3 seria efetivamente atingido', async () => {
    const store = degradedStore('deg-2');

    let excedeu = false;
    for (let i = 0; i < 10; i++) {
      const r = await store.increment('brute-force');
      if (r.totalHits > 3) excedeu = true;
    }

    // Antes da correcao isto era `false` para sempre: totalHits ficava em 1.
    expect(excedeu).toBe(true);
  });

  it('chaves diferentes contam separadamente', async () => {
    const store = degradedStore('deg-3');

    await store.increment('chave-a');
    await store.increment('chave-a');
    const b = await store.increment('chave-b');

    expect(b.totalHits).toBe(1);
  });

  it('avisa no log que o rate limiting esta degradado', async () => {
    const store = degradedStore('deg-4');
    await store.increment('qualquer');

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('DEGRADADO')
    );
  });

  it('usa o Redis normalmente quando ele responde', async () => {
    // rate-limit-redis chama SCRIPT LOAD no construtor e depois EVALSHA.
    (redis as any).call.mockImplementation((...args: string[]) => {
      const cmd = args[0]?.toUpperCase();
      if (cmd === 'SCRIPT') return Promise.resolve('sha-fake');
      return Promise.resolve([42, 30_000]);
    });

    const store: any = createRedisStore('ok-1');
    store.init({ windowMs: 60_000 });

    const r = await store.increment('chave');
    expect(r.totalHits).toBe(42);
  });
});
