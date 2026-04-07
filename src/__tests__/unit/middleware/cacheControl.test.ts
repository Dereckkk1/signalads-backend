/**
 * Unit tests para cacheControl middleware.
 * Testa setCacheHeaders com os tres tipos: public, private, none.
 */

import { Request, Response, NextFunction } from 'express';
import { setCacheHeaders } from '../../../middleware/cacheControl';
import {
    createMockRequest,
    createMockNext,
} from '../../helpers/testHelpers';

// ── Helper: response mock that captures res.set() calls ──
function createCacheResponse() {
    const headers: Record<string, string> = {};
    return {
        headers,
        set(name: string, value: string) {
            headers[name] = value;
        },
    };
}

// ─── Setup ─────────────────────────────────────────────────────
beforeEach(() => {
    jest.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════
// setCacheHeaders — factory
// ═══════════════════════════════════════════════════════════════
describe('setCacheHeaders — factory', () => {
    it('deve retornar uma funcao middleware', () => {
        const middleware = setCacheHeaders('public');
        expect(typeof middleware).toBe('function');
        expect(middleware.length).toBe(3); // _req, res, next
    });
});

// ═══════════════════════════════════════════════════════════════
// setCacheHeaders — type 'public'
// ═══════════════════════════════════════════════════════════════
describe('setCacheHeaders — public', () => {
    it('deve setar Cache-Control public com defaults', () => {
        const middleware = setCacheHeaders('public');
        const req = createMockRequest();
        const res = createCacheResponse();
        const next = createMockNext();

        middleware(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(res.headers['Cache-Control']).toBe('public, max-age=30, s-maxage=60');
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('deve respeitar maxAge customizado', () => {
        const middleware = setCacheHeaders('public', 120);
        const req = createMockRequest();
        const res = createCacheResponse();
        const next = createMockNext();

        middleware(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(res.headers['Cache-Control']).toBe('public, max-age=120, s-maxage=240');
    });

    it('deve respeitar sMaxAge customizado', () => {
        const middleware = setCacheHeaders('public', 60, 300);
        const req = createMockRequest();
        const res = createCacheResponse();
        const next = createMockNext();

        middleware(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(res.headers['Cache-Control']).toBe('public, max-age=60, s-maxage=300');
    });

    it('deve calcular s-maxage como maxAge * 2 por padrao', () => {
        const middleware = setCacheHeaders('public', 45);
        const req = createMockRequest();
        const res = createCacheResponse();
        const next = createMockNext();

        middleware(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(res.headers['Cache-Control']).toContain('s-maxage=90');
    });

    it('deve chamar next() apos setar header', () => {
        const middleware = setCacheHeaders('public');
        const req = createMockRequest();
        const res = createCacheResponse();
        const next = createMockNext();

        middleware(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalledTimes(1);
    });
});

// ═══════════════════════════════════════════════════════════════
// setCacheHeaders — type 'private'
// ═══════════════════════════════════════════════════════════════
describe('setCacheHeaders — private', () => {
    it('deve setar Cache-Control private com defaults', () => {
        const middleware = setCacheHeaders('private');
        const req = createMockRequest();
        const res = createCacheResponse();
        const next = createMockNext();

        middleware(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(res.headers['Cache-Control']).toBe('private, max-age=30, must-revalidate');
    });

    it('deve respeitar maxAge customizado', () => {
        const middleware = setCacheHeaders('private', 60);
        const req = createMockRequest();
        const res = createCacheResponse();
        const next = createMockNext();

        middleware(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(res.headers['Cache-Control']).toBe('private, max-age=60, must-revalidate');
    });

    it('deve incluir must-revalidate', () => {
        const middleware = setCacheHeaders('private', 10);
        const req = createMockRequest();
        const res = createCacheResponse();
        const next = createMockNext();

        middleware(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(res.headers['Cache-Control']).toContain('must-revalidate');
    });

    it('nao deve incluir s-maxage (CDN nao deve cachear)', () => {
        const middleware = setCacheHeaders('private');
        const req = createMockRequest();
        const res = createCacheResponse();
        const next = createMockNext();

        middleware(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(res.headers['Cache-Control']).not.toContain('s-maxage');
    });

    it('deve chamar next()', () => {
        const middleware = setCacheHeaders('private');
        const req = createMockRequest();
        const res = createCacheResponse();
        const next = createMockNext();

        middleware(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalledTimes(1);
    });
});

// ═══════════════════════════════════════════════════════════════
// setCacheHeaders — type 'none'
// ═══════════════════════════════════════════════════════════════
describe('setCacheHeaders — none', () => {
    it('deve setar Cache-Control no-store', () => {
        const middleware = setCacheHeaders('none');
        const req = createMockRequest();
        const res = createCacheResponse();
        const next = createMockNext();

        middleware(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(res.headers['Cache-Control']).toBe('no-store');
    });

    it('deve ignorar parametros maxAge e sMaxAge', () => {
        const middleware = setCacheHeaders('none', 999, 999);
        const req = createMockRequest();
        const res = createCacheResponse();
        const next = createMockNext();

        middleware(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(res.headers['Cache-Control']).toBe('no-store');
        expect(res.headers['Cache-Control']).not.toContain('max-age');
    });

    it('deve chamar next()', () => {
        const middleware = setCacheHeaders('none');
        const req = createMockRequest();
        const res = createCacheResponse();
        const next = createMockNext();

        middleware(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalledTimes(1);
    });
});

// ═══════════════════════════════════════════════════════════════
// setCacheHeaders — maxAge = 0
// ═══════════════════════════════════════════════════════════════
describe('setCacheHeaders — edge cases', () => {
    it('deve funcionar com maxAge = 0 para public', () => {
        const middleware = setCacheHeaders('public', 0);
        const req = createMockRequest();
        const res = createCacheResponse();
        const next = createMockNext();

        middleware(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(res.headers['Cache-Control']).toBe('public, max-age=0, s-maxage=0');
    });

    it('deve funcionar com maxAge = 0 para private', () => {
        const middleware = setCacheHeaders('private', 0);
        const req = createMockRequest();
        const res = createCacheResponse();
        const next = createMockNext();

        middleware(req as unknown as Request, res as unknown as Response, next as NextFunction);

        expect(res.headers['Cache-Control']).toBe('private, max-age=0, must-revalidate');
    });
});
