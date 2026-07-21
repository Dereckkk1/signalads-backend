/**
 * Integration Tests — Defesas que nao executavam (Fase 4)
 *
 * Regressao de `docs/security-remediation-plan-2026-07-20.md`:
 *  - 4.2 sanitizacao de req.query realmente EXECUTA atraves do Express
 *  - 4.4 mongoSanitize nao corrompe mais valores string
 *
 * IMPORTANTE — por que estes testes sao de INTEGRACAO e nao unitarios:
 * o bug original passou despercebido justamente porque os testes chamavam
 * `mongoSanitize(req)` com um objeto literal, onde mutar funciona. Atraves do
 * Express real, `req.query` e um getter sem memoizacao e a mutacao se perde.
 * So um teste que passa pelo servidor prova que a defesa esta viva.
 */

import '../helpers/mocks';

import request from 'supertest';
import express, { Application, Request, Response } from 'express';
import cookieParser from 'cookie-parser';

import { mongoSanitize, xssSanitize, sanitizeQuery } from '../../middleware/security';

let app: Application;

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-key-for-testing-12345';
  process.env.NODE_ENV = 'test';

  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use(mongoSanitize);
  app.use(xssSanitize);
  app.use(sanitizeQuery);

  // Eco do que o CONTROLLER enxerga — nao o que o middleware pensou ter feito.
  app.get('/eco', (req: Request, res: Response) => {
    res.json({ query: req.query });
  });
  app.post('/eco', (req: Request, res: Response) => {
    res.json({ body: req.body });
  });
});

// ─────────────────────────────────────────────────────────────
// 4.2 — a sanitizacao de query precisa sobreviver ate o controller
// ─────────────────────────────────────────────────────────────
describe('4.2 — sanitizacao de req.query executa de verdade', () => {
  it('SEGURANCA: HPP — ?a=1&a=2 chega ao controller como valor unico', async () => {
    const res = await request(app).get('/eco?search=aa&search=bb');

    // Antes da correcao o controller recebia ['aa','bb'] e chamadas como
    // search.trim() lancavam TypeError -> 500 em rota publica.
    expect(res.body.query.search).toBe('bb');
    expect(Array.isArray(res.body.query.search)).toBe(false);
  });

  it('SEGURANCA: XSS em query chega escapado ao controller', async () => {
    const res = await request(app).get('/eco?q=' + encodeURIComponent('<script>alert(1)</script>radio'));

    expect(res.body.query.q).not.toContain('<script>');
    expect(res.body.query.q).toContain('radio');
  });

  it('SEGURANCA: chave com operador Mongo nao chega ao controller', async () => {
    const res = await request(app).get('/eco?' + encodeURIComponent('$where') + '=this.password&ok=1');

    expect(res.body.query['$where']).toBeUndefined();
    expect(res.body.query.ok).toBe('1');
  });

  it('valores legitimos passam intactos', async () => {
    const res = await request(app).get('/eco?cidade=' + encodeURIComponent('São Paulo') + '&limite=25');

    expect(res.body.query.cidade).toBe('São Paulo');
    expect(res.body.query.limite).toBe('25');
  });

  it('multiplas duplicatas colapsam todas', async () => {
    const res = await request(app).get('/eco?a=1&a=2&a=3&b=x&b=y');

    expect(res.body.query.a).toBe('3');
    expect(res.body.query.b).toBe('y');
  });
});

// ─────────────────────────────────────────────────────────────
// 4.4 — sanitizador nao pode corromper dado legitimo
// ─────────────────────────────────────────────────────────────
describe('4.4 — mongoSanitize preserva valores string', () => {
  it('SEGURANCA/UX: senha iniciada por $ chega intacta ao controller', async () => {
    const res = await request(app)
      .post('/eco')
      .send({ emailOrCnpj: 'a@b.com', password: '$enhaForte1' });

    // Antes, o valor virava '' e a conta ficava permanentemente inacessivel.
    expect(res.body.body.password).toBe('$enhaForte1');
  });

  it('preco em texto ("$100") nao e corrompido', async () => {
    const res = await request(app).post('/eco').send({ price: '$100' });
    expect(res.body.body.price).toBe('$100');
  });

  it('chave com operador continua sendo removida do body', async () => {
    const res = await request(app).post('/eco').send({ email: { $ne: null } });
    expect(res.body.body.email.$ne).toBeUndefined();
  });
});

// NOTA: o teste do item 4.1 (degradacao do rate limit) vive em
// `src/__tests__/unit/config/rateLimitStore.test.ts` — o helper global de
// mocks stuba `config/rateLimitStore`, entao ele nao pode ser exercitado aqui.

// ─────────────────────────────────────────────────────────────
// 4.8 — allowlist de ageRanges na rota publica do marketplace
// ─────────────────────────────────────────────────────────────
describe('4.8 — ageRanges nao aceita regex arbitraria', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { escapeRegex } = require('../../utils/stringUtils');

  it('escapeRegex neutraliza metacaracteres (base da correcao)', () => {
    // O "escape" anterior era `.replace('+', '\+')`: trocava apenas a
    // PRIMEIRA ocorrencia e ignorava . * ? ^ $ ( ) [ ] { } |
    expect(escapeRegex('(')).toBe(String.raw`\(`);
    expect(escapeRegex('.*')).toBe(String.raw`\.\*`);
    expect(escapeRegex('18+')).toBe(String.raw`18\+`);
    expect(escapeRegex('(a+)+$')).toBe(String.raw`\(a\+\)\+\$`);
  });

  it('valor escapado nao explode ao virar RegExp', () => {
    // Antes: `new RegExp('(')` lancava SyntaxError e a rota publica
    // respondia 500 para qualquer anonimo.
    expect(() => new RegExp(escapeRegex('('))).not.toThrow();
    expect(() => new RegExp(escapeRegex('[a-'))).not.toThrow();
  });

  it('".*" escapado casa o literal, nao "qualquer coisa"', () => {
    const re = new RegExp(escapeRegex('.*'), 'i');
    expect(re.test('.*')).toBe(true);
    expect(re.test('18+')).toBe(false); // antes casaria qualquer faixa
  });
});
