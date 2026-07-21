/**
 * Unit tests para auditLog middleware.
 * Testa que o middleware intercepta res.json() e cria audit logs
 * apenas para respostas 2xx de usuarios autenticados.
 */

import { Response, NextFunction } from 'express';
import { auditLog, filterSensitiveFields } from '../../../middleware/auditLog';
import { AuthRequest } from '../../../middleware/auth';
import {
    createMockRequest,
    createMockNext,
    randomObjectId,
} from '../../helpers/testHelpers';

// ── Mock AuditLog model ──
const mockCreate = jest.fn().mockResolvedValue({});
jest.mock('../../../models/AuditLog', () => ({
    __esModule: true,
    default: {
        create: (...args: any[]) => mockCreate(...args),
    },
}));

// ── Mock redis (required by auth import) ──
jest.mock('../../../config/redis', () => ({
    redis: { on: jest.fn(), status: 'ready', del: jest.fn(), get: jest.fn(), set: jest.fn() },
    cacheGet: jest.fn().mockResolvedValue(null),
    cacheSet: jest.fn().mockResolvedValue(undefined),
}));

// ── Mock User model (required by auth import) ──
jest.mock('../../../models/User', () => ({
    User: { findById: jest.fn() },
}));

// ── Helper: build a response object that tracks json/set calls ──
function createAuditMockResponse(statusCode: number = 200) {
    const res: any = {
        statusCode,
        json: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        headers: {},
    };
    // json.bind(res) in middleware needs this to work
    res.json.bind = jest.fn().mockReturnValue(res.json);
    return res;
}

// ─── Setup ─────────────────────────────────────────────────────
beforeEach(() => {
    jest.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════
// auditLog factory
// ═══════════════════════════════════════════════════════════════
describe('auditLog middleware factory', () => {
    it('deve retornar uma funcao middleware', () => {
        const middleware = auditLog('test.action', 'test');
        expect(typeof middleware).toBe('function');
        expect(middleware.length).toBe(3); // req, res, next
    });
});

// ═══════════════════════════════════════════════════════════════
// auditLog — chama next() sempre
// ═══════════════════════════════════════════════════════════════
describe('auditLog — next()', () => {
    it('deve sempre chamar next()', () => {
        const middleware = auditLog('test.action', 'test');
        const req = createMockRequest() as unknown as AuthRequest;
        const res = createAuditMockResponse();
        const next = createMockNext();

        middleware(req, res as unknown as Response, next as NextFunction);

        expect(next).toHaveBeenCalledTimes(1);
    });
});

// ═══════════════════════════════════════════════════════════════
// auditLog — intercepta res.json
// ═══════════════════════════════════════════════════════════════
describe('auditLog — intercepta res.json', () => {
    it('deve substituir res.json por uma funcao wrapper', () => {
        const middleware = auditLog('test.action', 'test');
        const req = createMockRequest() as unknown as AuthRequest;
        const res: any = {
            statusCode: 200,
            json: jest.fn(),
        };
        res.json.bind = jest.fn().mockReturnValue(res.json);
        const next = createMockNext();

        const originalJson = res.json;
        middleware(req, res as unknown as Response, next as NextFunction);

        // json should have been replaced
        expect(res.json).not.toBe(originalJson);
    });
});

// ═══════════════════════════════════════════════════════════════
// auditLog — cria log para sucesso 2xx com userId
// ═══════════════════════════════════════════════════════════════
describe('auditLog — logging em respostas 2xx', () => {
    it('deve criar AuditLog quando statusCode e 200 e userId existe', () => {
        const middleware = auditLog('user.update', 'user');
        const userId = randomObjectId();
        const req = createMockRequest({
            userId,
            body: { name: 'Test' },
            params: { id: 'resource-123' },
            ip: '192.168.1.1',
            headers: { 'user-agent': 'TestAgent/1.0' },
        }) as unknown as AuthRequest;

        const originalJsonFn = jest.fn();
        const res: any = {
            statusCode: 200,
            json: originalJsonFn,
        };
        res.json.bind = jest.fn().mockReturnValue(originalJsonFn);
        const next = createMockNext();

        middleware(req, res as unknown as Response, next as NextFunction);

        // Call the wrapped json
        res.json({ success: true });

        expect(mockCreate).toHaveBeenCalledTimes(1);
        expect(mockCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                userId,
                action: 'user.update',
                resource: 'user',
                resourceId: 'resource-123',
                ipAddress: '192.168.1.1',
                userAgent: 'TestAgent/1.0',
            })
        );
    });

    it('deve criar AuditLog quando statusCode e 201', () => {
        const middleware = auditLog('resource.create', 'resource');
        const userId = randomObjectId();
        const req = createMockRequest({
            userId,
            body: {},
            params: {},
        }) as unknown as AuthRequest;

        const originalJsonFn = jest.fn();
        const res: any = {
            statusCode: 201,
            json: originalJsonFn,
        };
        res.json.bind = jest.fn().mockReturnValue(originalJsonFn);
        const next = createMockNext();

        middleware(req, res as unknown as Response, next as NextFunction);
        res.json({ created: true });

        expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('deve passar o body original para o originalJson', () => {
        const middleware = auditLog('test.action', 'test');
        const userId = randomObjectId();
        const req = createMockRequest({ userId }) as unknown as AuthRequest;

        const originalJsonFn = jest.fn();
        const res: any = {
            statusCode: 200,
            json: originalJsonFn,
        };
        res.json.bind = jest.fn().mockReturnValue(originalJsonFn);
        const next = createMockNext();

        middleware(req, res as unknown as Response, next as NextFunction);

        const responseBody = { data: 'test-response' };
        res.json(responseBody);

        expect(originalJsonFn).toHaveBeenCalledWith(responseBody);
    });
});

// ═══════════════════════════════════════════════════════════════
// auditLog — NAO loga em cenarios invalidos
// ═══════════════════════════════════════════════════════════════
describe('auditLog — nao loga em cenarios invalidos', () => {
    it('nao deve criar log quando statusCode e 400 (erro client)', () => {
        const middleware = auditLog('test.action', 'test');
        const userId = randomObjectId();
        const req = createMockRequest({ userId }) as unknown as AuthRequest;

        const originalJsonFn = jest.fn();
        const res: any = {
            statusCode: 400,
            json: originalJsonFn,
        };
        res.json.bind = jest.fn().mockReturnValue(originalJsonFn);
        const next = createMockNext();

        middleware(req, res as unknown as Response, next as NextFunction);
        res.json({ error: 'bad request' });

        expect(mockCreate).not.toHaveBeenCalled();
    });

    it('nao deve criar log quando statusCode e 500 (erro server)', () => {
        const middleware = auditLog('test.action', 'test');
        const userId = randomObjectId();
        const req = createMockRequest({ userId }) as unknown as AuthRequest;

        const originalJsonFn = jest.fn();
        const res: any = {
            statusCode: 500,
            json: originalJsonFn,
        };
        res.json.bind = jest.fn().mockReturnValue(originalJsonFn);
        const next = createMockNext();

        middleware(req, res as unknown as Response, next as NextFunction);
        res.json({ error: 'internal error' });

        expect(mockCreate).not.toHaveBeenCalled();
    });

    it('nao deve criar log quando userId nao existe no request', () => {
        const middleware = auditLog('test.action', 'test');
        const req = createMockRequest({
            userId: undefined,
        }) as unknown as AuthRequest;

        const originalJsonFn = jest.fn();
        const res: any = {
            statusCode: 200,
            json: originalJsonFn,
        };
        res.json.bind = jest.fn().mockReturnValue(originalJsonFn);
        const next = createMockNext();

        middleware(req, res as unknown as Response, next as NextFunction);
        res.json({ success: true });

        expect(mockCreate).not.toHaveBeenCalled();
    });

    it('nao deve criar log quando statusCode e 404 sem resourceId (listagem)', () => {
        const middleware = auditLog('test.action', 'test');
        const userId = randomObjectId();
        const req = createMockRequest({ userId, params: {} }) as unknown as AuthRequest;

        const originalJsonFn = jest.fn();
        const res: any = {
            statusCode: 404,
            json: originalJsonFn,
        };
        res.json.bind = jest.fn().mockReturnValue(originalJsonFn);
        const next = createMockNext();

        middleware(req, res as unknown as Response, next as NextFunction);
        res.json({ error: 'not found' });

        expect(mockCreate).not.toHaveBeenCalled();
    });

    it('nao deve criar log em 403 quando nao ha ator identificado', () => {
        const middleware = auditLog('test.action', 'test');
        const req = createMockRequest({ userId: undefined, params: {} }) as unknown as AuthRequest;

        const originalJsonFn = jest.fn();
        const res: any = {
            statusCode: 403,
            json: originalJsonFn,
        };
        res.json.bind = jest.fn().mockReturnValue(originalJsonFn);
        const next = createMockNext();

        middleware(req, res as unknown as Response, next as NextFunction);
        res.json({ error: 'forbidden' });

        expect(mockCreate).not.toHaveBeenCalled();
    });
});

// ═══════════════════════════════════════════════════════════════
// auditLog — 4xx sensiveis (FASE 9.1)
// ═══════════════════════════════════════════════════════════════
describe('auditLog — tentativas negadas (4xx sensiveis)', () => {
    function runWithStatus(statusCode: number, reqOverrides: any = {}, action = 'test.action') {
        const middleware = auditLog(action, 'test');
        const req = createMockRequest({ params: {}, ...reqOverrides }) as unknown as AuthRequest;
        const originalJsonFn = jest.fn();
        const res: any = { statusCode, json: originalJsonFn };
        res.json.bind = jest.fn().mockReturnValue(originalJsonFn);
        middleware(req, res as unknown as Response, createMockNext() as NextFunction);
        res.json({ error: 'denied' });
        return { originalJsonFn };
    }

    it('deve registrar 403 de usuario identificado com sufixo .denied', () => {
        runWithStatus(403, { userId: randomObjectId() }, 'user.role_change');

        expect(mockCreate).toHaveBeenCalledTimes(1);
        const call = mockCreate.mock.calls[0][0];
        expect(call.action).toBe('user.role_change.denied');
        expect(call.details.outcome).toBe('denied');
        expect(call.details.responseStatus).toBe(403);
    });

    it('deve registrar 401 em rota anonima (allowAnonymous)', () => {
        const middleware = auditLog('auth.login', 'user', { allowAnonymous: true });
        const req = createMockRequest({ userId: undefined, params: {} }) as unknown as AuthRequest;
        const originalJsonFn = jest.fn();
        const res: any = { statusCode: 401, json: originalJsonFn };
        res.json.bind = jest.fn().mockReturnValue(originalJsonFn);
        middleware(req, res as unknown as Response, createMockNext() as NextFunction);
        res.json({ error: 'Credenciais inválidas' });

        expect(mockCreate).toHaveBeenCalledTimes(1);
        expect(mockCreate.mock.calls[0][0].action).toBe('auth.login.denied');
    });

    it('deve registrar 404 quando ha resourceId (enumeracao de IDs)', () => {
        runWithStatus(404, { userId: randomObjectId(), params: { userId: 'alvo-123' } }, 'user.pii_read');

        expect(mockCreate).toHaveBeenCalledTimes(1);
        expect(mockCreate.mock.calls[0][0].action).toBe('user.pii_read.denied');
        expect(mockCreate.mock.calls[0][0].resourceId).toBe('alvo-123');
    });

    it('nao deve registrar 429 nem 409 (ruido)', () => {
        runWithStatus(429, { userId: randomObjectId() });
        runWithStatus(409, { userId: randomObjectId() });
        expect(mockCreate).not.toHaveBeenCalled();
    });
});

// ═══════════════════════════════════════════════════════════════
// auditLog — filtragem de campos sensiveis
// ═══════════════════════════════════════════════════════════════
describe('auditLog — filtragem de campos sensiveis', () => {
    it('deve redactar password no body logado', () => {
        const middleware = auditLog('user.update', 'user');
        const userId = randomObjectId();
        const req = createMockRequest({
            userId,
            body: { password: 'secret123', name: 'Test' },
            params: {},
        }) as unknown as AuthRequest;

        const originalJsonFn = jest.fn();
        const res: any = {
            statusCode: 200,
            json: originalJsonFn,
        };
        res.json.bind = jest.fn().mockReturnValue(originalJsonFn);
        const next = createMockNext();

        middleware(req, res as unknown as Response, next as NextFunction);
        res.json({ success: true });

        const createCall = mockCreate.mock.calls[0][0];
        expect(createCall.details.requestBody.password).toBe('[REDACTED]');
        expect(createCall.details.requestBody.name).toBe('Test');
    });

    it('deve redactar newPassword e currentPassword', () => {
        const middleware = auditLog('user.change_password', 'user');
        const userId = randomObjectId();
        const req = createMockRequest({
            userId,
            body: { newPassword: 'new123', currentPassword: 'old123' },
            params: {},
        }) as unknown as AuthRequest;

        const originalJsonFn = jest.fn();
        const res: any = {
            statusCode: 200,
            json: originalJsonFn,
        };
        res.json.bind = jest.fn().mockReturnValue(originalJsonFn);
        const next = createMockNext();

        middleware(req, res as unknown as Response, next as NextFunction);
        res.json({ success: true });

        const createCall = mockCreate.mock.calls[0][0];
        expect(createCall.details.requestBody.newPassword).toBe('[REDACTED]');
        expect(createCall.details.requestBody.currentPassword).toBe('[REDACTED]');
    });

    it('deve redactar token e secret', () => {
        const middleware = auditLog('auth.action', 'auth');
        const userId = randomObjectId();
        const req = createMockRequest({
            userId,
            body: { token: 'abc123', secret: 'xyz789', email: 'test@test.com' },
            params: {},
        }) as unknown as AuthRequest;

        const originalJsonFn = jest.fn();
        const res: any = {
            statusCode: 200,
            json: originalJsonFn,
        };
        res.json.bind = jest.fn().mockReturnValue(originalJsonFn);
        const next = createMockNext();

        middleware(req, res as unknown as Response, next as NextFunction);
        res.json({ success: true });

        const createCall = mockCreate.mock.calls[0][0];
        expect(createCall.details.requestBody.token).toBe('[REDACTED]');
        expect(createCall.details.requestBody.secret).toBe('[REDACTED]');
        expect(createCall.details.requestBody.email).toBe('test@test.com');
    });
});

// ═══════════════════════════════════════════════════════════════
// auditLog — resourceId resolve de diferentes params
// ═══════════════════════════════════════════════════════════════
describe('auditLog — resourceId fallback', () => {
    it('deve usar broadcasterId quando disponivel', () => {
        const middleware = auditLog('broadcaster.update', 'broadcaster');
        const userId = randomObjectId();
        const broadcasterId = randomObjectId();
        const req = createMockRequest({
            userId,
            body: {},
            params: { broadcasterId, orderId: 'order-1', id: 'generic-1' },
        }) as unknown as AuthRequest;

        const originalJsonFn = jest.fn();
        const res: any = { statusCode: 200, json: originalJsonFn };
        res.json.bind = jest.fn().mockReturnValue(originalJsonFn);
        const next = createMockNext();

        middleware(req, res as unknown as Response, next as NextFunction);
        res.json({});

        expect(mockCreate.mock.calls[0][0].resourceId).toBe(broadcasterId);
    });

    it('deve usar orderId quando broadcasterId nao existe', () => {
        const middleware = auditLog('order.update', 'order');
        const userId = randomObjectId();
        const req = createMockRequest({
            userId,
            body: {},
            params: { orderId: 'order-123' },
        }) as unknown as AuthRequest;

        const originalJsonFn = jest.fn();
        const res: any = { statusCode: 200, json: originalJsonFn };
        res.json.bind = jest.fn().mockReturnValue(originalJsonFn);
        const next = createMockNext();

        middleware(req, res as unknown as Response, next as NextFunction);
        res.json({});

        expect(mockCreate.mock.calls[0][0].resourceId).toBe('order-123');
    });

    it('deve usar id como ultimo fallback', () => {
        const middleware = auditLog('generic.action', 'generic');
        const userId = randomObjectId();
        const req = createMockRequest({
            userId,
            body: {},
            params: { id: 'generic-id' },
        }) as unknown as AuthRequest;

        const originalJsonFn = jest.fn();
        const res: any = { statusCode: 200, json: originalJsonFn };
        res.json.bind = jest.fn().mockReturnValue(originalJsonFn);
        const next = createMockNext();

        middleware(req, res as unknown as Response, next as NextFunction);
        res.json({});

        expect(mockCreate.mock.calls[0][0].resourceId).toBe('generic-id');
    });
});

// ═══════════════════════════════════════════════════════════════
// auditLog — erro no AuditLog.create nao propaga
// ═══════════════════════════════════════════════════════════════
describe('auditLog — resiliencia a erros', () => {
    it('nao deve propagar erro quando AuditLog.create falha', () => {
        mockCreate.mockRejectedValueOnce(new Error('DB error'));

        const middleware = auditLog('test.action', 'test');
        const userId = randomObjectId();
        const req = createMockRequest({ userId, params: {} }) as unknown as AuthRequest;

        const originalJsonFn = jest.fn();
        const res: any = { statusCode: 200, json: originalJsonFn };
        res.json.bind = jest.fn().mockReturnValue(originalJsonFn);
        const next = createMockNext();

        middleware(req, res as unknown as Response, next as NextFunction);

        // Should not throw
        expect(() => res.json({ success: true })).not.toThrow();
        expect(originalJsonFn).toHaveBeenCalledWith({ success: true });
    });
});

// ═══════════════════════════════════════════════════════════════
// filterSensitiveFields — recursao (FASE 9.3)
// ═══════════════════════════════════════════════════════════════
describe('filterSensitiveFields — recursivo', () => {
    it('deve redactar senha em nivel 3 de aninhamento', () => {
        const input = {
            level1: {
                level2: {
                    level3: { password: 'secret123', name: 'ok' },
                },
            },
        };
        const out = filterSensitiveFields(input);
        expect(out.level1.level2.level3.password).toBe('[REDACTED]');
        expect(out.level1.level2.level3.name).toBe('ok');
    });

    it('deve redactar dentro de arrays de objetos', () => {
        const out = filterSensitiveFields({
            users: [{ email: 'a@b.com', apiKey: 'k1' }, { email: 'c@d.com', apiKey: 'k2' }],
        });
        expect(out.users[0].apiKey).toBe('[REDACTED]');
        expect(out.users[1].apiKey).toBe('[REDACTED]');
        expect(out.users[0].email).toBe('a@b.com');
    });

    it('deve cobrir a lista ampliada de campos sensiveis', () => {
        const out = filterSensitiveFields({
            pin: '1234',
            twoFactorCode: '999999',
            apiKey: 'ak',
            accessToken: 'at',
            refresh_token: 'rt',
            Authorization: 'Bearer x',
            cpfOrCnpj: '123.456.789-00',
            cpfCnpj: '12345678900',
            ccv: '123',
            cardNumber: '4111111111111111',
            companyName: 'Radio FM',
        });
        for (const key of ['pin', 'twoFactorCode', 'apiKey', 'accessToken', 'refresh_token', 'Authorization', 'cpfOrCnpj', 'cpfCnpj', 'ccv', 'cardNumber']) {
            expect(out[key]).toBe('[REDACTED]');
        }
        expect(out.companyName).toBe('Radio FM');
    });

    it('deve comparar por includes em lowercase (userPassword, X-Api-Key)', () => {
        const out = filterSensitiveFields({ userPassword: 'x', 'X-Api-Key': 'y', publicField: 'z' });
        expect(out.userPassword).toBe('[REDACTED]');
        expect(out['X-Api-Key']).toBe('[REDACTED]');
        expect(out.publicField).toBe('z');
    });

    it('nao deve redactar falso-positivo curto (shipping vs pin)', () => {
        const out = filterSensitiveFields({ shipping: 'expresso', spinner: 'on' });
        expect(out.shipping).toBe('expresso');
        expect(out.spinner).toBe('on');
    });

    it('deve suportar objeto ciclico sem estourar', () => {
        const obj: any = { name: 'raiz', password: 'p' };
        obj.self = obj;
        const out = filterSensitiveFields(obj);
        expect(out.password).toBe('[REDACTED]');
        expect(out.self).toBe('[CIRCULAR]');
    });

    it('deve cortar por profundidade maxima', () => {
        let deep: any = { password: 'p' };
        for (let i = 0; i < 12; i++) deep = { nested: deep };
        const out = filterSensitiveFields(deep);
        const serialized = JSON.stringify(out);
        expect(serialized).toContain('[MAX_DEPTH]');
        expect(serialized).not.toContain('"p"');
    });

    it('deve retornar valores primitivos inalterados', () => {
        expect(filterSensitiveFields(null)).toBeNull();
        expect(filterSensitiveFields('texto')).toBe('texto');
        expect(filterSensitiveFields(42)).toBe(42);
    });
});
