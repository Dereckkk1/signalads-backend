/**
 * Unit Tests — getUserIdFromToken (chave de rate limit)
 *
 * Regressao da correcao 1.3 do plano de seguranca 2026-07-20.
 *
 * Antes da correcao a funcao usava jwt.decode() (sem verificar assinatura),
 * o que permitia a um atacante ANONIMO forjar { userId: <vitima> } e esgotar
 * o balde de rate limit da vitima — DoS direcionado por conta.
 */

import jwt from 'jsonwebtoken';
import { Request } from 'express';
import { getUserIdFromToken } from '../../../utils/rateLimitKey';

const SECRET = 'test-secret-key-for-testing-12345';
const VICTIM_ID = '507f1f77bcf86cd799439011';

const reqWithToken = (token?: string) =>
  ({ cookies: token ? { access_token: token } : {} } as unknown as Request);

beforeAll(() => {
  process.env.JWT_SECRET = SECRET;
});

describe('getUserIdFromToken', () => {
  it('retorna o userId quando o token tem assinatura valida', () => {
    const token = jwt.sign({ userId: VICTIM_ID }, SECRET, { expiresIn: '15m' });
    expect(getUserIdFromToken(reqWithToken(token))).toBe(VICTIM_ID);
  });

  it('retorna null quando nao ha cookie', () => {
    expect(getUserIdFromToken(reqWithToken())).toBeNull();
  });

  it('SEGURANCA: rejeita token assinado com outro segredo (forjado)', () => {
    const forged = jwt.sign({ userId: VICTIM_ID }, 'segredo-do-atacante', { expiresIn: '15m' });
    expect(getUserIdFromToken(reqWithToken(forged))).toBeNull();
  });

  it('SEGURANCA: rejeita token com alg=none (sem assinatura)', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ userId: VICTIM_ID })).toString('base64url');
    const unsigned = `${header}.${payload}.`;
    expect(getUserIdFromToken(reqWithToken(unsigned))).toBeNull();
  });

  it('SEGURANCA: rejeita token HS256 valido porem expirado', () => {
    const expired = jwt.sign({ userId: VICTIM_ID }, SECRET, { expiresIn: '-1s' });
    expect(getUserIdFromToken(reqWithToken(expired))).toBeNull();
  });

  it('retorna null para lixo que nao e JWT', () => {
    expect(getUserIdFromToken(reqWithToken('nao-é-um-jwt'))).toBeNull();
  });

  it('retorna null quando JWT_SECRET nao esta definido', () => {
    const token = jwt.sign({ userId: VICTIM_ID }, SECRET, { expiresIn: '15m' });
    const original = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    try {
      expect(getUserIdFromToken(reqWithToken(token))).toBeNull();
    } finally {
      process.env.JWT_SECRET = original;
    }
  });
});
