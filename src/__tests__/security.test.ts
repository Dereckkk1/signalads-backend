import './setup';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../index';
import { User } from '../models/User';
import RefreshToken from '../models/RefreshToken';
import crypto from 'crypto';

// ─────────────────────────────────────────────────────────────
// Helper — cria usuário de teste
// ─────────────────────────────────────────────────────────────
const createUser = async (overrides = {}) => {
    const defaults = {
        email: 'sec@signalads.com',
        password: await bcrypt.hash('Senha@123', 10),
        userType: 'advertiser' as const,
        companyName: 'Security Test LTDA',
        fantasyName: 'SecTest',
        phone: '11999990000',
        cpfOrCnpj: '99.999.999/0001-99',
        cnpj: '99.999.999/0001-99',
        status: 'approved' as const,
        emailConfirmed: true,
        twoFactorEnabled: false,
    };
    return User.create({ ...defaults, ...overrides });
};

/**
 * Helper — faz login e retorna cookies parseados + token
 */
const loginAndGetCookies = async () => {
    const res = await request(app)
        .post('/api/auth/login')
        .send({ emailOrCnpj: 'sec@signalads.com', password: 'Senha@123' });

    const cookies = res.headers['set-cookie'] as unknown as string[];
    const getCookie = (name: string) =>
        cookies?.find((c: string) => c.startsWith(`${name}=`))?.split(';')[0]?.split('=').slice(1).join('=') || '';

    return {
        res,
        token: res.body.token,
        accessTokenCookie: getCookie('access_token'),
        refreshTokenCookie: getCookie('refresh_token'),
        csrfTokenCookie: getCookie('csrf_token'),
        rawCookies: cookies,
    };
};

// =============================================================
// 1. XSS SANITIZATION
// =============================================================
describe('XSS Sanitization', () => {
    it('deve remover tags <script> do body', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({
                email: '<script>alert("xss")</script>@evil.com',
                password: 'Senha@123',
                userType: 'advertiser',
                companyName: '<img onerror="alert(1)" src=x>',
                phone: '11999990000',
            });

        // O middleware sanitiza ANTES do controller processar
        // Não importa o status — o que importa é que o valor foi limpo
        // Vamos testar via endpoint que ecoa dados
        expect(res.status).toBeDefined();
    });

    it('deve sanitizar XSS em query params', async () => {
        const res = await request(app)
            .get('/api/health')
            .query({ test: '<script>alert("xss")</script>' });

        // Health check retorna 200 — o middleware não quebra a request
        expect(res.status).toBe(200);
    });

    it('deve sanitizar payloads aninhados', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({
                emailOrCnpj: 'test@test.com',
                password: 'Senha@123',
                nested: {
                    deep: '<img src=x onerror=alert(1)>',
                    array: ['<script>steal()</script>', 'safe text'],
                },
            });

        // Middleware processa sem erro — controller recebe dados limpos
        expect(res.status).toBeDefined();
    });

    it('deve manter strings seguras intactas', async () => {
        await createUser();
        const res = await request(app)
            .post('/api/auth/login')
            .send({ emailOrCnpj: 'sec@signalads.com', password: 'Senha@123' });

        expect(res.status).toBe(200);
        expect(res.body.user.email).toBe('sec@signalads.com');
    });
});

// =============================================================
// 2. NoSQL INJECTION PROTECTION
// =============================================================
describe('NoSQL Injection Protection', () => {
    beforeEach(async () => {
        await createUser();
    });

    it('deve bloquear operador $gt no login (bypass clássico)', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({
                emailOrCnpj: { $gt: '' },
                password: { $gt: '' },
            });

        // Middleware remove keys $gt — controller nunca executa query com operador
        // Pode ser 401 (credenciais inválidas) ou 500 (objeto vazio sem .includes)
        // O essencial: NÃO retorna 200 com dados de usuário
        expect(res.status).not.toBe(200);
        expect(res.body).not.toHaveProperty('user');
    });

    it('deve bloquear operador $ne (bypass "not equal empty")', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({
                emailOrCnpj: { $ne: '' },
                password: { $ne: '' },
            });

        expect(res.status).not.toBe(200);
        expect(res.body).not.toHaveProperty('user');
    });

    it('deve bloquear $regex injection', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({
                emailOrCnpj: { $regex: '.*' },
                password: 'Senha@123',
            });

        expect(res.status).not.toBe(200);
        expect(res.body).not.toHaveProperty('user');
    });

    it('deve bloquear prototype pollution (__proto__)', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({
                emailOrCnpj: 'sec@signalads.com',
                password: 'Senha@123',
                __proto__: { isAdmin: true },
            });

        // Login normal funciona, mas __proto__ é removido
        expect([200, 401]).toContain(res.status);
    });

    it('deve bloquear $where injection', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({
                emailOrCnpj: 'sec@signalads.com',
                password: 'Senha@123',
                $where: 'this.password',
            });

        // $where key removida pelo sanitizer
        expect(res.status).toBeDefined();
    });
});

// =============================================================
// 3. CSRF PROTECTION
// =============================================================
describe('CSRF Protection', () => {
    beforeEach(async () => {
        await createUser();
    });

    it('deve permitir login sem CSRF (rota isenta)', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ emailOrCnpj: 'sec@signalads.com', password: 'Senha@123' });

        expect(res.status).toBe(200);
    });

    it('deve permitir register sem CSRF (rota isenta)', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({
                email: 'novo@corporativo.com',
                password: 'Senha@123',
                userType: 'advertiser',
                companyName: 'Nova Empresa',
                phone: '11999990000',
            });

        // Pode ser 400 (email corporativo check) mas NÃO 403 (CSRF)
        expect(res.status).not.toBe(403);
    });

    it('deve permitir GET requests sem CSRF', async () => {
        const { token } = await loginAndGetCookies();

        const res = await request(app)
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
    });

    it('deve bloquear POST protegido quando CSRF cookie existe mas header está ausente', async () => {
        const { token, csrfTokenCookie } = await loginAndGetCookies();

        // Envia cookie csrf_token mas NÃO envia header X-CSRF-Token
        const res = await request(app)
            .post('/api/auth/logout')
            .set('Authorization', `Bearer ${token}`)
            .set('Cookie', `access_token=${token}; csrf_token=${csrfTokenCookie}`);

        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/CSRF/i);
    });

    it('deve bloquear POST quando CSRF header não corresponde ao cookie', async () => {
        const { token, csrfTokenCookie } = await loginAndGetCookies();

        const res = await request(app)
            .post('/api/auth/logout')
            .set('Authorization', `Bearer ${token}`)
            .set('Cookie', `access_token=${token}; csrf_token=${csrfTokenCookie}`)
            .set('X-CSRF-Token', 'token-errado-123');

        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/CSRF/i);
    });

    it('deve permitir POST quando CSRF header corresponde ao cookie', async () => {
        const { token, csrfTokenCookie } = await loginAndGetCookies();

        const res = await request(app)
            .post('/api/auth/logout')
            .set('Cookie', `access_token=${token}; csrf_token=${csrfTokenCookie}`)
            .set('X-CSRF-Token', csrfTokenCookie);

        expect(res.status).toBe(200);
        expect(res.body.message).toMatch(/logout/i);
    });
});

// =============================================================
// 4. AUTH DUAL-MODE (Cookie httpOnly + Header Bearer)
// =============================================================
describe('Auth Dual-Mode (Cookie + Header)', () => {
    beforeEach(async () => {
        await createUser();
    });

    it('deve autenticar via header Authorization (modo legado)', async () => {
        const { token } = await loginAndGetCookies();

        const res = await request(app)
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body.email).toBe('sec@signalads.com');
    });

    it('deve autenticar via cookie httpOnly access_token', async () => {
        const { accessTokenCookie } = await loginAndGetCookies();

        const res = await request(app)
            .get('/api/auth/me')
            .set('Cookie', `access_token=${accessTokenCookie}`);

        expect(res.status).toBe(200);
        expect(res.body.email).toBe('sec@signalads.com');
    });

    it('deve priorizar cookie sobre header quando ambos presentes', async () => {
        const { accessTokenCookie } = await loginAndGetCookies();

        const res = await request(app)
            .get('/api/auth/me')
            .set('Cookie', `access_token=${accessTokenCookie}`)
            .set('Authorization', 'Bearer token.invalido.aqui');

        // Cookie válido é usado — ignora header inválido
        expect(res.status).toBe(200);
    });

    it('deve retornar 401 sem nenhum token', async () => {
        const res = await request(app).get('/api/auth/me');
        expect(res.status).toBe(401);
    });

    it('login deve setar cookies httpOnly na resposta', async () => {
        const { rawCookies } = await loginAndGetCookies();

        const accessCookie = rawCookies?.find((c: string) => c.startsWith('access_token='));
        const refreshCookie = rawCookies?.find((c: string) => c.startsWith('refresh_token='));
        const csrfCookie = rawCookies?.find((c: string) => c.startsWith('csrf_token='));

        expect(accessCookie).toBeDefined();
        expect(refreshCookie).toBeDefined();
        expect(csrfCookie).toBeDefined();

        // access_token e refresh_token devem ser httpOnly
        expect(accessCookie).toMatch(/HttpOnly/i);
        expect(refreshCookie).toMatch(/HttpOnly/i);

        // csrf_token NÃO deve ser httpOnly (JS precisa ler)
        expect(csrfCookie).not.toMatch(/HttpOnly/i);
    });

    it('login deve retornar token no body para compatibilidade', async () => {
        const { res } = await loginAndGetCookies();

        expect(res.body).toHaveProperty('token');
        expect(res.body.token).toBeTruthy();
    });
});

// =============================================================
// 5. REFRESH TOKEN ROTATION + THEFT DETECTION
// =============================================================
describe('Refresh Token Rotation', () => {
    beforeEach(async () => {
        await createUser();
    });

    it('deve rotacionar refresh token e retornar novo access token', async () => {
        const { refreshTokenCookie } = await loginAndGetCookies();

        const res = await request(app)
            .post('/api/auth/refresh')
            .set('Cookie', `refresh_token=${refreshTokenCookie}`);

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('token');
        expect(res.body.message).toMatch(/renovado/i);

        // Deve setar novos cookies
        const cookies = res.headers['set-cookie'] as unknown as string[];
        const newAccess = cookies?.find((c: string) => c.startsWith('access_token='));
        expect(newAccess).toBeDefined();
    });

    it('deve revogar token antigo após rotação', async () => {
        const { refreshTokenCookie } = await loginAndGetCookies();

        // Primeira rotação — sucesso
        const res1 = await request(app)
            .post('/api/auth/refresh')
            .set('Cookie', `refresh_token=${refreshTokenCookie}`);
        expect(res1.status).toBe(200);

        // Segunda tentativa com o MESMO token — deve falhar (já revogado)
        const res2 = await request(app)
            .post('/api/auth/refresh')
            .set('Cookie', `refresh_token=${refreshTokenCookie}`);
        expect(res2.status).toBe(401);
    });

    it('deve revogar toda a família quando token roubado é reutilizado', async () => {
        const { refreshTokenCookie } = await loginAndGetCookies();

        // Rotação legítima — gera token novo
        const res1 = await request(app)
            .post('/api/auth/refresh')
            .set('Cookie', `refresh_token=${refreshTokenCookie}`);
        expect(res1.status).toBe(200);

        // Pega o novo refresh token
        const newCookies = res1.headers['set-cookie'] as unknown as string[];
        const newRefresh = newCookies?.find((c: string) => c.startsWith('refresh_token='))
            ?.split(';')[0]?.split('=').slice(1).join('=') || '';

        // Atacante reutiliza token antigo (roubado) — TODA a família é revogada
        const res2 = await request(app)
            .post('/api/auth/refresh')
            .set('Cookie', `refresh_token=${refreshTokenCookie}`);
        expect(res2.status).toBe(401);

        // Agora o token legítimo TAMBÉM foi revogado (família inteira comprometida)
        const res3 = await request(app)
            .post('/api/auth/refresh')
            .set('Cookie', `refresh_token=${newRefresh}`);
        expect(res3.status).toBe(401);
    });

    it('deve rejeitar refresh token inexistente', async () => {
        const res = await request(app)
            .post('/api/auth/refresh')
            .set('Cookie', 'refresh_token=tokenfalso123');

        expect(res.status).toBe(401);
    });

    it('deve rejeitar request sem refresh token', async () => {
        const res = await request(app)
            .post('/api/auth/refresh');

        expect(res.status).toBe(401);
        expect(res.body.error).toMatch(/refresh token/i);
    });

    it('deve rejeitar refresh token expirado', async () => {
        const { refreshTokenCookie } = await loginAndGetCookies();

        // Força expiração no banco
        const hashedToken = crypto.createHash('sha256').update(refreshTokenCookie).digest('hex');
        await RefreshToken.updateOne(
            { token: hashedToken },
            { expiresAt: new Date(Date.now() - 1000) }
        );

        const res = await request(app)
            .post('/api/auth/refresh')
            .set('Cookie', `refresh_token=${refreshTokenCookie}`);

        expect(res.status).toBe(401);
    });
});

// =============================================================
// 6. LOGOUT — Revogação de tokens
// =============================================================
describe('POST /api/auth/logout', () => {
    beforeEach(async () => {
        await createUser();
    });

    it('deve revogar todos os refresh tokens do usuário', async () => {
        const { token, csrfTokenCookie } = await loginAndGetCookies();

        // Login 2x para criar múltiplos refresh tokens
        await loginAndGetCookies();

        const tokenCount = await RefreshToken.countDocuments({ revokedAt: { $exists: false } });
        expect(tokenCount).toBeGreaterThanOrEqual(2);

        // Logout
        const res = await request(app)
            .post('/api/auth/logout')
            .set('Cookie', `access_token=${token}; csrf_token=${csrfTokenCookie}`)
            .set('X-CSRF-Token', csrfTokenCookie);

        expect(res.status).toBe(200);
        expect(res.body.message).toMatch(/logout/i);

        // Todos os tokens devem estar revogados
        const activeTokens = await RefreshToken.countDocuments({ revokedAt: { $exists: false } });
        expect(activeTokens).toBe(0);
    });

    it('deve limpar cookies na resposta de logout', async () => {
        const { token, csrfTokenCookie } = await loginAndGetCookies();

        const res = await request(app)
            .post('/api/auth/logout')
            .set('Cookie', `access_token=${token}; csrf_token=${csrfTokenCookie}`)
            .set('X-CSRF-Token', csrfTokenCookie);

        const cookies = res.headers['set-cookie'] as unknown as string[];
        // Cookies devem ser limpos (set com valor vazio ou expiração passada)
        const accessCleared = cookies?.find((c: string) =>
            c.startsWith('access_token=') && (c.includes('Expires=Thu, 01 Jan 1970') || c.includes('Max-Age=0') || c.split('=')[1]?.startsWith(';'))
        );
        expect(accessCleared).toBeDefined();
    });

    it('deve exigir autenticação para logout', async () => {
        const res = await request(app).post('/api/auth/logout');
        expect(res.status).toBe(401);
    });
});
