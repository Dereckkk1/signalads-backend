/**
 * Unit tests para auth middleware.
 * Testa requireAdmin e authenticateToken com mocks.
 *
 * Nota: authenticateToken depende de Redis e MongoDB (User.findById),
 * portanto testamos apenas os cenarios basicos que nao dependem de DB.
 * Para authenticateToken com user lookup, ver integration tests.
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import {
    requireAdmin,
    authenticateToken,
    optionalAuthenticateToken,
    requireBroadcasterManager,
    invalidateUserCache,
    AuthRequest,
} from '../../../middleware/auth';
import {
    createMockRequest,
    createMockResponse,
    createMockNext,
    TEST_JWT_SECRET,
    randomObjectId,
} from '../../helpers/testHelpers';

// ── Mockar redis para que o import de auth.ts nao tente conectar ──
jest.mock('../../../config/redis', () => ({
    redis: {
        del: jest.fn().mockResolvedValue(0),
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue('OK'),
        on: jest.fn(),
        status: 'ready',
    },
    cacheGet: jest.fn().mockResolvedValue(null),
    cacheSet: jest.fn().mockResolvedValue(undefined),
}));

// ── Mockar User model ──
jest.mock('../../../models/User', () => ({
    User: {
        findById: jest.fn(),
    },
}));

// Import mocked module
import { User } from '../../../models/User';
import { cacheGet, redis } from '../../../config/redis';

const mockedUser = User as jest.Mocked<typeof User>;
const mockedCacheGet = cacheGet as jest.MockedFunction<typeof cacheGet>;
const mockedRedisDel = redis.del as jest.MockedFunction<typeof redis.del>;

// ─── Setup ─────────────────────────────────────────────────────
beforeEach(() => {
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    process.env.NODE_ENV = 'test';
    jest.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════
// requireAdmin
// ═══════════════════════════════════════════════════════════════
describe('requireAdmin', () => {
    it('deve retornar 403 quando user nao esta no request', () => {
        const req = createMockRequest();
        const res = createMockResponse();
        const next = createMockNext();

        requireAdmin(
            req as unknown as AuthRequest,
            res as unknown as Response,
            next as NextFunction,
        );

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
        expect(res.jsonData.error).toMatch(/administrador/i);
    });

    it('deve retornar 403 quando user.userType e "advertiser"', () => {
        const req = createMockRequest({
            user: { _id: randomObjectId(), email: 'user@test.com', userType: 'advertiser' },
        });
        const res = createMockResponse();
        const next = createMockNext();

        requireAdmin(
            req as unknown as AuthRequest,
            res as unknown as Response,
            next as NextFunction,
        );

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
        expect(res.jsonData.error).toMatch(/administrador/i);
    });

    it('deve retornar 403 quando user.userType e "broadcaster"', () => {
        const req = createMockRequest({
            user: { _id: randomObjectId(), email: 'radio@test.com', userType: 'broadcaster' },
        });
        const res = createMockResponse();
        const next = createMockNext();

        requireAdmin(
            req as unknown as AuthRequest,
            res as unknown as Response,
            next as NextFunction,
        );

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
    });

    it('deve retornar 403 quando user.userType e "agency"', () => {
        const req = createMockRequest({
            user: { _id: randomObjectId(), email: 'agency@test.com', userType: 'agency' },
        });
        const res = createMockResponse();
        const next = createMockNext();

        requireAdmin(
            req as unknown as AuthRequest,
            res as unknown as Response,
            next as NextFunction,
        );

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
    });

    it('deve chamar next() quando user.userType e "admin"', () => {
        const req = createMockRequest({
            user: { _id: randomObjectId(), email: 'admin@signalads.com', userType: 'admin' },
        });
        const res = createMockResponse();
        const next = createMockNext();

        requireAdmin(
            req as unknown as AuthRequest,
            res as unknown as Response,
            next as NextFunction,
        );

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.statusCode).toBe(200); // Nao foi alterado
    });

    it('deve retornar 403 quando user e undefined', () => {
        const req = createMockRequest({
            user: undefined,
        });
        const res = createMockResponse();
        const next = createMockNext();

        requireAdmin(
            req as unknown as AuthRequest,
            res as unknown as Response,
            next as NextFunction,
        );

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
    });

    it('deve retornar 403 quando userType esta ausente no user', () => {
        const req = createMockRequest({
            user: { _id: randomObjectId(), email: 'test@test.com' },
        });
        const res = createMockResponse();
        const next = createMockNext();

        requireAdmin(
            req as unknown as AuthRequest,
            res as unknown as Response,
            next as NextFunction,
        );

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
    });
});

// ═══════════════════════════════════════════════════════════════
// authenticateToken — sem token
// ═══════════════════════════════════════════════════════════════
describe('authenticateToken — sem token', () => {
    it('deve retornar 401 quando nao ha access_token no cookie', async () => {
        const req = createMockRequest({
            cookies: {},
        });
        const res = createMockResponse();
        const next = createMockNext();

        await authenticateToken(
            req as unknown as AuthRequest,
            res as unknown as Response,
            next as NextFunction,
        );

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(401);
        expect(res.jsonData.error).toMatch(/token/i);
    });

    it('deve retornar 401 quando cookies e undefined', async () => {
        const req = createMockRequest({
            cookies: undefined as any,
        });
        const res = createMockResponse();
        const next = createMockNext();

        await authenticateToken(
            req as unknown as AuthRequest,
            res as unknown as Response,
            next as NextFunction,
        );

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(401);
    });

    it('deve retornar 401 quando access_token e string vazia', async () => {
        const req = createMockRequest({
            cookies: { access_token: '' },
        });
        const res = createMockResponse();
        const next = createMockNext();

        await authenticateToken(
            req as unknown as AuthRequest,
            res as unknown as Response,
            next as NextFunction,
        );

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(401);
    });
});

// ═══════════════════════════════════════════════════════════════
// authenticateToken — token invalido
// ═══════════════════════════════════════════════════════════════
describe('authenticateToken — token invalido', () => {
    it('deve retornar 401 com token JWT invalido', async () => {
        const req = createMockRequest({
            cookies: { access_token: 'invalid.jwt.token' },
        });
        const res = createMockResponse();
        const next = createMockNext();

        await authenticateToken(
            req as unknown as AuthRequest,
            res as unknown as Response,
            next as NextFunction,
        );

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(401);
        expect(res.jsonData.error).toMatch(/inv/i);
    });

    it('deve retornar 401 com token assinado com secret diferente', async () => {
        const token = jwt.sign({ userId: randomObjectId() }, 'wrong-secret', { expiresIn: '15m' });
        const req = createMockRequest({
            cookies: { access_token: token },
        });
        const res = createMockResponse();
        const next = createMockNext();

        await authenticateToken(
            req as unknown as AuthRequest,
            res as unknown as Response,
            next as NextFunction,
        );

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(401);
    });

    it('deve retornar 401 com token expirado', async () => {
        const token = jwt.sign({ userId: randomObjectId() }, TEST_JWT_SECRET, { expiresIn: '0s' });

        // Aguarda 1s para garantir expiracao
        await new Promise(resolve => setTimeout(resolve, 1100));

        const req = createMockRequest({
            cookies: { access_token: token },
        });
        const res = createMockResponse();
        const next = createMockNext();

        await authenticateToken(
            req as unknown as AuthRequest,
            res as unknown as Response,
            next as NextFunction,
        );

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(401);
    });

    it('deve retornar 401 com token aleatorio (nao-JWT)', async () => {
        const req = createMockRequest({
            cookies: { access_token: 'just-a-random-string-not-jwt' },
        });
        const res = createMockResponse();
        const next = createMockNext();

        await authenticateToken(
            req as unknown as AuthRequest,
            res as unknown as Response,
            next as NextFunction,
        );

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(401);
    });
});

// ═══════════════════════════════════════════════════════════════
// authenticateToken — token valido com cache hit
// ═══════════════════════════════════════════════════════════════
describe('authenticateToken — token valido + cache hit', () => {
    it('deve chamar next() e setar req.user quando user esta no cache com status approved', async () => {
        const userId = randomObjectId();
        const token = jwt.sign({ userId }, TEST_JWT_SECRET, { expiresIn: '15m' });

        const cachedUser = {
            _id: userId,
            email: 'cached@test.com',
            userType: 'advertiser',
            status: 'approved',
        };

        mockedCacheGet.mockResolvedValueOnce(cachedUser);

        const req = createMockRequest({
            cookies: { access_token: token },
        });
        const res = createMockResponse();
        const next = createMockNext();

        await authenticateToken(
            req as unknown as AuthRequest,
            res as unknown as Response,
            next as NextFunction,
        );

        expect(next).toHaveBeenCalled();
        expect((req as any).userId).toBe(userId);
        expect((req as any).user).toEqual(cachedUser);
    });

    it('deve retornar 403 quando user no cache tem status diferente de approved', async () => {
        const userId = randomObjectId();
        const token = jwt.sign({ userId }, TEST_JWT_SECRET, { expiresIn: '15m' });

        mockedCacheGet.mockResolvedValueOnce({
            _id: userId,
            email: 'pending@test.com',
            userType: 'advertiser',
            status: 'pending',
        });

        const req = createMockRequest({
            cookies: { access_token: token },
        });
        const res = createMockResponse();
        const next = createMockNext();

        await authenticateToken(
            req as unknown as AuthRequest,
            res as unknown as Response,
            next as NextFunction,
        );

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
        expect(res.jsonData.error).toMatch(/suspensa|pendente/i);
    });

    it('deve retornar 403 quando user no cache tem status rejected', async () => {
        const userId = randomObjectId();
        const token = jwt.sign({ userId }, TEST_JWT_SECRET, { expiresIn: '15m' });

        mockedCacheGet.mockResolvedValueOnce({
            _id: userId,
            email: 'rejected@test.com',
            userType: 'advertiser',
            status: 'rejected',
        });

        const req = createMockRequest({
            cookies: { access_token: token },
        });
        const res = createMockResponse();
        const next = createMockNext();

        await authenticateToken(
            req as unknown as AuthRequest,
            res as unknown as Response,
            next as NextFunction,
        );

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
    });
});

// ═══════════════════════════════════════════════════════════════
// authenticateToken — token valido, cache miss, DB lookup
// ═══════════════════════════════════════════════════════════════
describe('authenticateToken — token valido + cache miss + DB lookup', () => {
    it('deve retornar 401 quando user nao existe no banco', async () => {
        const userId = randomObjectId();
        const token = jwt.sign({ userId }, TEST_JWT_SECRET, { expiresIn: '15m' });

        mockedCacheGet.mockResolvedValueOnce(null);
        (mockedUser.findById as jest.Mock).mockReturnValueOnce({
            select: jest.fn().mockResolvedValueOnce(null),
        });

        const req = createMockRequest({
            cookies: { access_token: token },
        });
        const res = createMockResponse();
        const next = createMockNext();

        await authenticateToken(
            req as unknown as AuthRequest,
            res as unknown as Response,
            next as NextFunction,
        );

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(401);
        expect(res.jsonData.error).toMatch(/usu/i);
    });

    it('deve retornar 403 quando user do banco tem status pending', async () => {
        const userId = randomObjectId();
        const token = jwt.sign({ userId }, TEST_JWT_SECRET, { expiresIn: '15m' });

        mockedCacheGet.mockResolvedValueOnce(null);
        (mockedUser.findById as jest.Mock).mockReturnValueOnce({
            select: jest.fn().mockResolvedValueOnce({
                _id: userId,
                email: 'pending@test.com',
                userType: 'advertiser',
                status: 'pending',
                toObject: () => ({
                    _id: userId,
                    email: 'pending@test.com',
                    userType: 'advertiser',
                    status: 'pending',
                }),
            }),
        });

        const req = createMockRequest({
            cookies: { access_token: token },
        });
        const res = createMockResponse();
        const next = createMockNext();

        await authenticateToken(
            req as unknown as AuthRequest,
            res as unknown as Response,
            next as NextFunction,
        );

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
    });

    it('deve chamar next() e popular req quando user do banco e approved', async () => {
        const userId = randomObjectId();
        const token = jwt.sign({ userId }, TEST_JWT_SECRET, { expiresIn: '15m' });

        const dbUser = {
            _id: userId,
            email: 'approved@test.com',
            userType: 'admin',
            status: 'approved',
            toObject: () => ({
                _id: userId,
                email: 'approved@test.com',
                userType: 'admin',
                status: 'approved',
            }),
        };

        mockedCacheGet.mockResolvedValueOnce(null);
        (mockedUser.findById as jest.Mock).mockReturnValueOnce({
            select: jest.fn().mockResolvedValueOnce(dbUser),
        });

        const req = createMockRequest({
            cookies: { access_token: token },
        });
        const res = createMockResponse();
        const next = createMockNext();

        await authenticateToken(
            req as unknown as AuthRequest,
            res as unknown as Response,
            next as NextFunction,
        );

        expect(next).toHaveBeenCalled();
        expect((req as any).userId).toBe(userId);
        expect((req as any).user).toBe(dbUser);
    });
});

// ═══════════════════════════════════════════════════════════════
// authenticateToken — JWT_SECRET nao definido
// ═══════════════════════════════════════════════════════════════
describe('authenticateToken — JWT_SECRET ausente', () => {
    it('deve retornar 401 quando JWT_SECRET nao esta definido (error generico)', async () => {
        delete process.env.JWT_SECRET;

        const req = createMockRequest({
            cookies: { access_token: 'some-token' },
        });
        const res = createMockResponse();
        const next = createMockNext();

        await authenticateToken(
            req as unknown as AuthRequest,
            res as unknown as Response,
            next as NextFunction,
        );

        // O middleware cai no catch e retorna 401 com "Token invalido"
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(401);

        // Restore
        process.env.JWT_SECRET = TEST_JWT_SECRET;
    });
});

// ═══════════════════════════════════════════════════════════════
// optionalAuthenticateToken
// ═══════════════════════════════════════════════════════════════
describe('optionalAuthenticateToken', () => {
    it('deve chamar next() sem autenticar quando nao ha token', async () => {
        const req = createMockRequest({ cookies: {} });
        const res = createMockResponse();
        const next = createMockNext();

        await optionalAuthenticateToken(
            req as unknown as AuthRequest,
            res as unknown as Response,
            next as NextFunction,
        );

        expect(next).toHaveBeenCalled();
        expect((req as any).user).toBeUndefined();
    });

    it('deve chamar next() sem autenticar quando JWT_SECRET ausente', async () => {
        const originalSecret = process.env.JWT_SECRET;
        delete process.env.JWT_SECRET;

        const req = createMockRequest({ cookies: { access_token: 'some-token' } });
        const res = createMockResponse();
        const next = createMockNext();

        await optionalAuthenticateToken(
            req as unknown as AuthRequest,
            res as unknown as Response,
            next as NextFunction,
        );

        expect(next).toHaveBeenCalled();
        expect((req as any).user).toBeUndefined();

        process.env.JWT_SECRET = originalSecret;
    });

    it('deve popular req.user quando cache hit', async () => {
        const userId = randomObjectId();
        const token = jwt.sign({ userId }, TEST_JWT_SECRET, { expiresIn: '15m' });

        const cachedUser = { _id: userId, email: 'c@t.com', userType: 'advertiser', status: 'approved' };
        mockedCacheGet.mockResolvedValueOnce(cachedUser);

        const req = createMockRequest({ cookies: { access_token: token } });
        const res = createMockResponse();
        const next = createMockNext();

        await optionalAuthenticateToken(
            req as unknown as AuthRequest,
            res as unknown as Response,
            next as NextFunction,
        );

        expect(next).toHaveBeenCalled();
        expect((req as any).user).toEqual(cachedUser);
        expect((req as any).userId).toBe(userId);
    });

    it('deve popular req.user quando cache miss e user existe no DB', async () => {
        const userId = randomObjectId();
        const token = jwt.sign({ userId }, TEST_JWT_SECRET, { expiresIn: '15m' });

        const dbUser = {
            _id: userId,
            email: 'db@t.com',
            userType: 'admin',
            status: 'approved',
            toObject: () => ({ _id: userId, email: 'db@t.com', userType: 'admin', status: 'approved' }),
        };

        mockedCacheGet.mockResolvedValueOnce(null);
        (mockedUser.findById as jest.Mock).mockReturnValueOnce({
            select: jest.fn().mockResolvedValueOnce(dbUser),
        });

        const req = createMockRequest({ cookies: { access_token: token } });
        const res = createMockResponse();
        const next = createMockNext();

        await optionalAuthenticateToken(
            req as unknown as AuthRequest,
            res as unknown as Response,
            next as NextFunction,
        );

        expect(next).toHaveBeenCalled();
        expect((req as any).user).toBe(dbUser);
    });

    it('deve chamar next() sem autenticar quando cache miss e user nao existe no DB', async () => {
        const userId = randomObjectId();
        const token = jwt.sign({ userId }, TEST_JWT_SECRET, { expiresIn: '15m' });

        mockedCacheGet.mockResolvedValueOnce(null);
        (mockedUser.findById as jest.Mock).mockReturnValueOnce({
            select: jest.fn().mockResolvedValueOnce(null),
        });

        const req = createMockRequest({ cookies: { access_token: token } });
        const res = createMockResponse();
        const next = createMockNext();

        await optionalAuthenticateToken(
            req as unknown as AuthRequest,
            res as unknown as Response,
            next as NextFunction,
        );

        expect(next).toHaveBeenCalled();
        expect((req as any).user).toBeUndefined();
    });

    it('deve chamar next() silenciosamente quando token e invalido', async () => {
        const req = createMockRequest({ cookies: { access_token: 'invalid.jwt.token' } });
        const res = createMockResponse();
        const next = createMockNext();

        await optionalAuthenticateToken(
            req as unknown as AuthRequest,
            res as unknown as Response,
            next as NextFunction,
        );

        expect(next).toHaveBeenCalled();
        expect((req as any).user).toBeUndefined();
    });
});

// ═══════════════════════════════════════════════════════════════
// requireBroadcasterManager
// ═══════════════════════════════════════════════════════════════
describe('requireBroadcasterManager', () => {
    it('deve retornar 403 quando user nao e broadcaster', () => {
        const req = createMockRequest({
            user: { _id: randomObjectId(), email: 'a@t.com', userType: 'advertiser' },
        });
        const res = createMockResponse();
        const next = createMockNext();

        requireBroadcasterManager(
            req as unknown as AuthRequest,
            res as unknown as Response,
            next as NextFunction,
        );

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
        expect(res.jsonData.error).toMatch(/emissoras/i);
    });

    it('deve retornar 403 quando broadcasterRole e sales', () => {
        const req = createMockRequest({
            user: {
                _id: randomObjectId(),
                email: 'sales@t.com',
                userType: 'broadcaster',
                broadcasterRole: 'sales',
            },
        });
        const res = createMockResponse();
        const next = createMockNext();

        requireBroadcasterManager(
            req as unknown as AuthRequest,
            res as unknown as Response,
            next as NextFunction,
        );

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
        expect(res.jsonData.error).toMatch(/gerenciador/i);
    });

    it('deve chamar next() quando user e broadcaster manager', () => {
        const req = createMockRequest({
            user: {
                _id: randomObjectId(),
                email: 'manager@t.com',
                userType: 'broadcaster',
                broadcasterRole: 'manager',
            },
        });
        const res = createMockResponse();
        const next = createMockNext();

        requireBroadcasterManager(
            req as unknown as AuthRequest,
            res as unknown as Response,
            next as NextFunction,
        );

        expect(next).toHaveBeenCalledTimes(1);
    });

    it('deve chamar next() quando broadcaster sem broadcasterRole explicito', () => {
        const req = createMockRequest({
            user: { _id: randomObjectId(), email: 'b@t.com', userType: 'broadcaster' },
        });
        const res = createMockResponse();
        const next = createMockNext();

        requireBroadcasterManager(
            req as unknown as AuthRequest,
            res as unknown as Response,
            next as NextFunction,
        );

        expect(next).toHaveBeenCalledTimes(1);
    });
});

// ═══════════════════════════════════════════════════════════════
// invalidateUserCache
// ═══════════════════════════════════════════════════════════════
describe('invalidateUserCache', () => {
    it('deve chamar redis.del com a chave correta', async () => {
        const userId = randomObjectId();
        await invalidateUserCache(userId);
        expect(mockedRedisDel).toHaveBeenCalledWith(`auth:user:${userId}`);
    });

    it('deve engolir erros sem propagar', async () => {
        mockedRedisDel.mockRejectedValueOnce(new Error('redis down'));
        const userId = randomObjectId();
        await expect(invalidateUserCache(userId)).resolves.toBeUndefined();
    });
});
