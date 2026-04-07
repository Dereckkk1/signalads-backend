/**
 * Unit tests para tokenService.
 * Testa generateAccessToken, setAuthCookies e clearAuthCookies.
 * (rotateRefreshToken e generateRefreshToken precisam de MongoDB — integration tests)
 */

import jwt from 'jsonwebtoken';
import { generateAccessToken, setAuthCookies, clearAuthCookies } from '../../../utils/tokenService';
import {
    createMockResponse,
    TEST_JWT_SECRET,
    randomObjectId,
} from '../../helpers/testHelpers';

// ─── Setup ─────────────────────────────────────────────────────
const originalEnv = { ...process.env };

beforeEach(() => {
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    process.env.NODE_ENV = 'test';
});

afterEach(() => {
    process.env = { ...originalEnv };
    // Restore JWT_SECRET for subsequent tests
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    process.env.NODE_ENV = 'test';
});

// ═══════════════════════════════════════════════════════════════
// generateAccessToken
// ═══════════════════════════════════════════════════════════════
describe('generateAccessToken', () => {
    it('deve retornar um JWT valido contendo userId', () => {
        const userId = randomObjectId();
        const token = generateAccessToken(userId);

        expect(typeof token).toBe('string');
        expect(token.split('.')).toHaveLength(3); // header.payload.signature

        const decoded = jwt.verify(token, TEST_JWT_SECRET) as { userId: string; exp: number; iat: number };
        expect(decoded.userId).toBe(userId);
    });

    it('deve incluir expiracao no token (expiresIn 15m)', () => {
        const userId = randomObjectId();
        const token = generateAccessToken(userId);

        const decoded = jwt.verify(token, TEST_JWT_SECRET) as { exp: number; iat: number };
        const diffSeconds = decoded.exp - decoded.iat;

        // 15 minutos = 900 segundos
        expect(diffSeconds).toBe(900);
    });

    it('deve gerar tokens diferentes para userIds diferentes', () => {
        const userId1 = randomObjectId();
        const userId2 = randomObjectId();

        const token1 = generateAccessToken(userId1);
        const token2 = generateAccessToken(userId2);

        expect(token1).not.toBe(token2);
    });

    it('deve gerar tokens diferentes para o mesmo userId (iat diferente)', async () => {
        const userId = randomObjectId();
        const token1 = generateAccessToken(userId);

        // Pequeno delay para garantir timestamp diferente
        await new Promise(resolve => setTimeout(resolve, 1100));

        const token2 = generateAccessToken(userId);
        expect(token1).not.toBe(token2);
    });

    it('deve lancar erro quando JWT_SECRET nao esta definido', () => {
        delete process.env.JWT_SECRET;

        expect(() => generateAccessToken(randomObjectId())).toThrow(
            /JWT_SECRET/
        );
    });

    it('deve lancar erro quando JWT_SECRET e string vazia', () => {
        process.env.JWT_SECRET = '';

        // jwt.sign com secret vazio nao lanca, mas nosso codigo checa
        // A verificacao e: if (!jwtSecret) throw
        expect(() => generateAccessToken(randomObjectId())).toThrow(
            /JWT_SECRET/
        );
    });

    it('token gerado deve ser verificavel com o mesmo secret', () => {
        const userId = randomObjectId();
        const token = generateAccessToken(userId);

        // Nao deve lancar
        expect(() => jwt.verify(token, TEST_JWT_SECRET)).not.toThrow();
    });

    it('token gerado nao deve ser verificavel com secret diferente', () => {
        const userId = randomObjectId();
        const token = generateAccessToken(userId);

        expect(() => jwt.verify(token, 'wrong-secret')).toThrow();
    });
});

// ═══════════════════════════════════════════════════════════════
// setAuthCookies
// ═══════════════════════════════════════════════════════════════
describe('setAuthCookies', () => {
    it('deve setar exatamente 3 cookies (access_token, refresh_token, csrf_token)', () => {
        const res = createMockResponse();
        setAuthCookies(res as any, 'test-access', 'test-refresh');

        const cookieNames = Object.keys(res.cookies);
        expect(cookieNames).toHaveLength(3);
        expect(cookieNames).toContain('access_token');
        expect(cookieNames).toContain('refresh_token');
        expect(cookieNames).toContain('csrf_token');
    });

    it('deve setar access_token com valor correto', () => {
        const res = createMockResponse();
        setAuthCookies(res as any, 'my-access-token', 'my-refresh-token');

        expect(res.cookies['access_token']?.value).toBe('my-access-token');
    });

    it('deve setar refresh_token com valor correto', () => {
        const res = createMockResponse();
        setAuthCookies(res as any, 'my-access-token', 'my-refresh-token');

        expect(res.cookies['refresh_token']?.value).toBe('my-refresh-token');
    });

    it('deve setar csrf_token com valor nao-vazio (gerado internamente)', () => {
        const res = createMockResponse();
        setAuthCookies(res as any, 'access', 'refresh');

        const csrfValue = res.cookies['csrf_token']?.value;
        expect(csrfValue).toBeTruthy();
        expect(typeof csrfValue).toBe('string');
        expect(csrfValue!.length).toBeGreaterThan(10); // 32 bytes hex = 64 chars
    });

    it('access_token deve ser httpOnly', () => {
        const res = createMockResponse();
        setAuthCookies(res as any, 'access', 'refresh');

        expect(res.cookies['access_token']?.options.httpOnly).toBe(true);
    });

    it('refresh_token deve ser httpOnly', () => {
        const res = createMockResponse();
        setAuthCookies(res as any, 'access', 'refresh');

        expect(res.cookies['refresh_token']?.options.httpOnly).toBe(true);
    });

    it('csrf_token NAO deve ser httpOnly (JS precisa ler)', () => {
        const res = createMockResponse();
        setAuthCookies(res as any, 'access', 'refresh');

        expect(res.cookies['csrf_token']?.options.httpOnly).toBe(false);
    });

    it('access_token deve ter sameSite lax', () => {
        const res = createMockResponse();
        setAuthCookies(res as any, 'access', 'refresh');

        expect(res.cookies['access_token']?.options.sameSite).toBe('lax');
    });

    it('refresh_token deve ter path restrito a /api/auth/refresh', () => {
        const res = createMockResponse();
        setAuthCookies(res as any, 'access', 'refresh');

        expect(res.cookies['refresh_token']?.options.path).toBe('/api/auth/refresh');
    });

    it('access_token deve ter path /', () => {
        const res = createMockResponse();
        setAuthCookies(res as any, 'access', 'refresh');

        expect(res.cookies['access_token']?.options.path).toBe('/');
    });

    it('access_token deve ter maxAge de 15 minutos', () => {
        const res = createMockResponse();
        setAuthCookies(res as any, 'access', 'refresh');

        // 15 min = 900000 ms
        expect(res.cookies['access_token']?.options.maxAge).toBe(15 * 60 * 1000);
    });

    it('refresh_token deve ter maxAge de 7 dias', () => {
        const res = createMockResponse();
        setAuthCookies(res as any, 'access', 'refresh');

        // 7 dias em ms
        expect(res.cookies['refresh_token']?.options.maxAge).toBe(7 * 24 * 60 * 60 * 1000);
    });

    it('csrf_token deve ser diferente a cada chamada', () => {
        const res1 = createMockResponse();
        const res2 = createMockResponse();

        setAuthCookies(res1 as any, 'access', 'refresh');
        setAuthCookies(res2 as any, 'access', 'refresh');

        // crypto.randomBytes gera valores diferentes
        expect(res1.cookies['csrf_token']?.value).not.toBe(res2.cookies['csrf_token']?.value);
    });
});

// ═══════════════════════════════════════════════════════════════
// clearAuthCookies
// ═══════════════════════════════════════════════════════════════
describe('clearAuthCookies', () => {
    it('deve limpar exatamente 3 cookies', () => {
        const res = createMockResponse();
        clearAuthCookies(res as any);

        const clearedNames = Object.keys(res.clearedCookies);
        expect(clearedNames).toHaveLength(3);
        expect(clearedNames).toContain('access_token');
        expect(clearedNames).toContain('refresh_token');
        expect(clearedNames).toContain('csrf_token');
    });

    it('deve limpar access_token com path /', () => {
        const res = createMockResponse();
        clearAuthCookies(res as any);

        expect(res.clearedCookies['access_token']).toEqual(
            expect.objectContaining({ path: '/' })
        );
    });

    it('deve limpar refresh_token com path /api/auth/refresh', () => {
        const res = createMockResponse();
        clearAuthCookies(res as any);

        expect(res.clearedCookies['refresh_token']).toEqual(
            expect.objectContaining({ path: '/api/auth/refresh' })
        );
    });

    it('deve limpar csrf_token com path /', () => {
        const res = createMockResponse();
        clearAuthCookies(res as any);

        expect(res.clearedCookies['csrf_token']).toEqual(
            expect.objectContaining({ path: '/' })
        );
    });
});
