/**
 * Unit tests para CSRF protection middleware.
 * Testa o double-submit cookie pattern.
 */

import { Request, Response, NextFunction } from 'express';
import { csrfProtection } from '../../../middleware/csrf';
import { createMockRequest, createMockResponse, createMockNext } from '../../helpers/testHelpers';

// ═══════════════════════════════════════════════════════════════
// Safe methods (GET, HEAD, OPTIONS)
// ═══════════════════════════════════════════════════════════════
describe('csrfProtection — safe methods', () => {
    it('deve permitir GET sem CSRF', () => {
        const req = createMockRequest({ method: 'GET', path: '/api/products' });
        const res = createMockResponse();
        const next = createMockNext();

        csrfProtection(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalled();
        expect(res.statusCode).toBe(200); // Nao foi alterado
    });

    it('deve permitir HEAD sem CSRF', () => {
        const req = createMockRequest({ method: 'HEAD', path: '/api/products' });
        const res = createMockResponse();
        const next = createMockNext();

        csrfProtection(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalled();
    });

    it('deve permitir OPTIONS sem CSRF', () => {
        const req = createMockRequest({ method: 'OPTIONS', path: '/api/products' });
        const res = createMockResponse();
        const next = createMockNext();

        csrfProtection(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalled();
    });
});

// ═══════════════════════════════════════════════════════════════
// Exempt routes
// ═══════════════════════════════════════════════════════════════
describe('csrfProtection — exempt routes', () => {
    const exemptRoutes = [
        '/api/auth/login',
        '/api/auth/register',
        '/api/auth/confirm-email',
        '/api/auth/2fa/confirm',
        '/api/auth/refresh',
        '/api/auth/logout',
        '/api/contact-messages',
        '/api/vitals',
    ];

    it.each(exemptRoutes)('deve permitir POST em rota isenta: %s', (route) => {
        const req = createMockRequest({
            method: 'POST',
            path: route,
            cookies: {}, // Sem cookies de auth
        });
        const res = createMockResponse();
        const next = createMockNext();

        csrfProtection(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalled();
    });

    it('deve permitir POST em sub-rota de rota isenta (ex: /api/auth/login/)', () => {
        const req = createMockRequest({
            method: 'POST',
            path: '/api/auth/login/',
        });
        const res = createMockResponse();
        const next = createMockNext();

        csrfProtection(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalled();
    });

    it('deve permitir POST em /api/vitals/subpath', () => {
        const req = createMockRequest({
            method: 'POST',
            path: '/api/vitals/web',
        });
        const res = createMockResponse();
        const next = createMockNext();

        csrfProtection(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalled();
    });
});

// ═══════════════════════════════════════════════════════════════
// Authenticated requests (has access_token cookie)
// ═══════════════════════════════════════════════════════════════
describe('csrfProtection — authenticated POST', () => {
    it('deve bloquear POST quando autenticado mas sem csrf_token cookie', () => {
        const req = createMockRequest({
            method: 'POST',
            path: '/api/orders',
            cookies: {
                access_token: 'some-valid-jwt',
                // Sem csrf_token
            },
            headers: {},
        });
        const res = createMockResponse();
        const next = createMockNext();

        csrfProtection(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
        expect(res.jsonData.error).toMatch(/CSRF/i);
    });

    it('deve bloquear POST quando csrf_token cookie existe mas header ausente', () => {
        const req = createMockRequest({
            method: 'POST',
            path: '/api/orders',
            cookies: {
                access_token: 'some-valid-jwt',
                csrf_token: 'valid-csrf-token-123',
            },
            headers: {
                // Sem X-CSRF-Token header
            },
        });
        const res = createMockResponse();
        const next = createMockNext();

        csrfProtection(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
        expect(res.jsonData.error).toMatch(/CSRF/i);
    });

    it('deve bloquear POST quando CSRF header nao corresponde ao cookie', () => {
        const req = createMockRequest({
            method: 'POST',
            path: '/api/orders',
            cookies: {
                access_token: 'some-valid-jwt',
                csrf_token: 'correct-csrf-token',
            },
            headers: {
                'x-csrf-token': 'wrong-csrf-token',
            },
        });
        const res = createMockResponse();
        const next = createMockNext();

        csrfProtection(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
        expect(res.jsonData.error).toMatch(/CSRF.*inv/i);
    });

    it('deve permitir POST quando CSRF header corresponde ao cookie', () => {
        const csrfToken = 'matching-csrf-token-abc123';
        const req = createMockRequest({
            method: 'POST',
            path: '/api/orders',
            cookies: {
                access_token: 'some-valid-jwt',
                csrf_token: csrfToken,
            },
            headers: {
                'x-csrf-token': csrfToken,
            },
        });
        const res = createMockResponse();
        const next = createMockNext();

        csrfProtection(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalled();
    });

    it('deve permitir PUT quando CSRF header corresponde ao cookie', () => {
        const csrfToken = 'matching-csrf-put';
        const req = createMockRequest({
            method: 'PUT',
            path: '/api/products/123',
            cookies: {
                access_token: 'some-valid-jwt',
                csrf_token: csrfToken,
            },
            headers: {
                'x-csrf-token': csrfToken,
            },
        });
        const res = createMockResponse();
        const next = createMockNext();

        csrfProtection(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalled();
    });

    it('deve permitir DELETE quando CSRF header corresponde ao cookie', () => {
        const csrfToken = 'matching-csrf-delete';
        const req = createMockRequest({
            method: 'DELETE',
            path: '/api/products/123',
            cookies: {
                access_token: 'some-valid-jwt',
                csrf_token: csrfToken,
            },
            headers: {
                'x-csrf-token': csrfToken,
            },
        });
        const res = createMockResponse();
        const next = createMockNext();

        csrfProtection(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalled();
    });

    it('deve permitir PATCH quando CSRF header corresponde ao cookie', () => {
        const csrfToken = 'matching-csrf-patch';
        const req = createMockRequest({
            method: 'PATCH',
            path: '/api/users/profile',
            cookies: {
                access_token: 'some-valid-jwt',
                csrf_token: csrfToken,
            },
            headers: {
                'x-csrf-token': csrfToken,
            },
        });
        const res = createMockResponse();
        const next = createMockNext();

        csrfProtection(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalled();
    });
});

// ═══════════════════════════════════════════════════════════════
// Unauthenticated requests (no access_token)
// ═══════════════════════════════════════════════════════════════
describe('csrfProtection — unauthenticated POST', () => {
    it('deve permitir POST sem autenticacao e sem csrf cookie (request publico)', () => {
        const req = createMockRequest({
            method: 'POST',
            path: '/api/some-public-endpoint',
            cookies: {}, // Sem access_token nem csrf_token
        });
        const res = createMockResponse();
        const next = createMockNext();

        csrfProtection(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalled();
    });

    it('deve verificar CSRF quando nao autenticado mas tem csrf cookie', () => {
        // Cenario: usuario teve cookies mas access_token expirou/foi removido
        const req = createMockRequest({
            method: 'POST',
            path: '/api/some-endpoint',
            cookies: {
                // Sem access_token
                csrf_token: 'stale-csrf-token',
            },
            headers: {
                'x-csrf-token': 'wrong-csrf-token',
            },
        });
        const res = createMockResponse();
        const next = createMockNext();

        csrfProtection(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
    });

    it('deve permitir quando nao autenticado mas csrf header e cookie correspondem', () => {
        const csrfToken = 'valid-csrf-no-auth';
        const req = createMockRequest({
            method: 'POST',
            path: '/api/some-endpoint',
            cookies: {
                csrf_token: csrfToken,
            },
            headers: {
                'x-csrf-token': csrfToken,
            },
        });
        const res = createMockResponse();
        const next = createMockNext();

        csrfProtection(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalled();
    });
});

// ═══════════════════════════════════════════════════════════════
// Edge cases
// ═══════════════════════════════════════════════════════════════
describe('csrfProtection — edge cases', () => {
    it('deve tratar cookies undefined', () => {
        const req = createMockRequest({
            method: 'POST',
            path: '/api/orders',
            cookies: undefined as any,
        });
        const res = createMockResponse();
        const next = createMockNext();

        csrfProtection(req as unknown as Request, res as unknown as Response, next as NextFunction);

        // Sem cookies = nao autenticado, sem csrf = permite
        expect(next).toHaveBeenCalled();
    });

    it('nao deve permitir POST protegido com CSRF token vazio', () => {
        const req = createMockRequest({
            method: 'POST',
            path: '/api/orders',
            cookies: {
                access_token: 'valid-jwt',
                csrf_token: '',
            },
            headers: {
                'x-csrf-token': '',
            },
        });
        const res = createMockResponse();
        const next = createMockNext();

        csrfProtection(req as unknown as Request, res as unknown as Response, next as NextFunction);

        // String vazia e falsy — hasAccessToken e true mas csrfFromCookie e falsy
        expect(res.statusCode).toBe(403);
    });

    it('deve ser sensivel a metodo (post minusculo vs POST)', () => {
        // O middleware faz req.method.toUpperCase(), entao 'post' vira 'POST'
        const csrfToken = 'valid-csrf';
        const req = createMockRequest({
            method: 'post',
            path: '/api/orders',
            cookies: {
                access_token: 'jwt',
                csrf_token: csrfToken,
            },
            headers: {
                'x-csrf-token': csrfToken,
            },
        });
        const res = createMockResponse();
        const next = createMockNext();

        csrfProtection(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalled();
    });
});

// ═══════════════════════════════════════════════════════════════
// Origin/Referer validation em rotas isentas (refresh)
// ═══════════════════════════════════════════════════════════════
describe('csrfProtection — Origin/Referer em /api/auth/refresh', () => {
    it('permite refresh com Origin permitido', () => {
        const req = createMockRequest({
            method: 'POST',
            path: '/api/auth/refresh',
            headers: { origin: 'http://localhost:3000' },
        });
        const res = createMockResponse();
        const next = createMockNext();

        csrfProtection(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalled();
    });

    it('bloqueia refresh com Origin nao permitido', () => {
        const req = createMockRequest({
            method: 'POST',
            path: '/api/auth/refresh',
            headers: { origin: 'https://evil.com' },
        });
        const res = createMockResponse();
        const next = createMockNext();

        csrfProtection(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
        expect(res.jsonData.error).toMatch(/origem/i);
    });

    it('permite refresh com Referer permitido (sem Origin)', () => {
        const req = createMockRequest({
            method: 'POST',
            path: '/api/auth/refresh',
            headers: { referer: 'http://localhost:3000/dashboard' },
        });
        const res = createMockResponse();
        const next = createMockNext();

        csrfProtection(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalled();
    });

    it('bloqueia refresh com Referer nao permitido', () => {
        const req = createMockRequest({
            method: 'POST',
            path: '/api/auth/refresh',
            headers: { referer: 'https://evil.com/page' },
        });
        const res = createMockResponse();
        const next = createMockNext();

        csrfProtection(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
    });

    it('bloqueia refresh com Referer malformado', () => {
        const req = createMockRequest({
            method: 'POST',
            path: '/api/auth/refresh',
            headers: { referer: 'not-a-valid-url' },
        });
        const res = createMockResponse();
        const next = createMockNext();

        csrfProtection(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
    });

    it('permite refresh server-to-server (sem Origin nem Referer)', () => {
        const req = createMockRequest({
            method: 'POST',
            path: '/api/auth/refresh',
            headers: {},
        });
        const res = createMockResponse();
        const next = createMockNext();

        csrfProtection(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalled();
    });
});
