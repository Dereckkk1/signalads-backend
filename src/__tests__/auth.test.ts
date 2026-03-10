import './setup'; // Configura MongoDB em memória para este arquivo de testes
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../index';
import { User } from '../models/User';

// ─────────────────────────────────────────────────────────────
// Helper para criar usuário de teste
// ─────────────────────────────────────────────────────────────
const createUser = async (overrides = {}) => {
    const defaults = {
        email: 'test@signalads.com',
        password: await bcrypt.hash('Senha@123', 10),
        userType: 'advertiser',
        companyName: 'Test Company LTDA',
        fantasyName: 'Test Co',
        phone: '11999990000',
        cpfOrCnpj: '12.345.678/0001-99',
        cnpj: '12.345.678/0001-99',
        status: 'approved',
        emailConfirmed: true,
        twoFactorEnabled: false,
    };
    return User.create({ ...defaults, ...overrides });
};

// ─────────────────────────────────────────────────────────────
// POST /api/auth/login — Login com email ou CNPJ
// ─────────────────────────────────────────────────────────────
describe('POST /api/auth/login', () => {
    beforeEach(async () => {
        await createUser();
    });

    it('deve retornar 200 e token com email válido', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ emailOrCnpj: 'test@signalads.com', password: 'Senha@123' });

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('token');
        expect(res.body.user).toMatchObject({
            email: 'test@signalads.com',
            userType: 'advertiser',
        });
    });

    it('deve retornar 401 com senha incorreta', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ emailOrCnpj: 'test@signalads.com', password: 'SenhaErrada@1' });

        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty('error');
    });

    it('deve retornar 401 com email inexistente', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ emailOrCnpj: 'naoexiste@test.com', password: 'Senha@123' });

        expect(res.status).toBe(401);
        expect(res.body.error).toMatch(/credenciais/i);
    });

    it('deve bloquear usuário com status "rejected" (banido)', async () => {
        await User.findOneAndUpdate(
            { email: 'test@signalads.com' },
            { status: 'rejected', rejectionReason: 'Comportamento suspeito' }
        );

        const res = await request(app)
            .post('/api/auth/login')
            .send({ emailOrCnpj: 'test@signalads.com', password: 'Senha@123' });

        expect(res.status).toBe(403);
        expect(res.body.error).toBe('account_rejected');
    });

    it('deve bloquear login com email não confirmado', async () => {
        await User.findOneAndUpdate(
            { email: 'test@signalads.com' },
            { emailConfirmed: false }
        );

        const res = await request(app)
            .post('/api/auth/login')
            .send({ emailOrCnpj: 'test@signalads.com', password: 'Senha@123' });

        expect(res.status).toBe(403);
        expect(res.body.error).toBe('email_not_confirmed');
    });

    it('deve responder em menos de 1500ms', async () => {
        const start = Date.now();

        await request(app)
            .post('/api/auth/login')
            .send({ emailOrCnpj: 'test@signalads.com', password: 'Senha@123' });

        const duration = Date.now() - start;
        expect(duration).toBeLessThan(1500);
    });

    it('JWT deve conter userId válido', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ emailOrCnpj: 'test@signalads.com', password: 'Senha@123' });

        expect(res.status).toBe(200);

        const [, payload] = res.body.token.split('.');
        const decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
        expect(decoded).toHaveProperty('userId');
        expect(decoded.userId).toBeTruthy();
    });
});

// ─────────────────────────────────────────────────────────────
// POST /api/auth/login — Login com CNPJ
// ─────────────────────────────────────────────────────────────
describe('POST /api/auth/login — via CNPJ', () => {
    beforeEach(async () => {
        // O authController busca cpfOrCnpj com o valor exato enviado pelo cliente
        // O frontend envia com máscara já preenchida no form (ex: 12.345.678/0001-99)
        await createUser({
            email: 'cnpj@signalads.com',
            cpfOrCnpj: '12.345.678/0001-99',
        });
    });

    it('deve logar com CNPJ no formato com máscara (como o frontend envia)', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ emailOrCnpj: '12.345.678/0001-99', password: 'Senha@123' });

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('token');
    });
});

// ─────────────────────────────────────────────────────────────
// GET /api/auth/me — Dados do usuário logado
// ─────────────────────────────────────────────────────────────
describe('GET /api/auth/me', () => {
    let token: string;

    beforeEach(async () => {
        await createUser();
        const res = await request(app)
            .post('/api/auth/login')
            .send({ emailOrCnpj: 'test@signalads.com', password: 'Senha@123' });
        token = res.body.token;
    });

    it('deve retornar dados do usuário com token válido', async () => {
        const res = await request(app)
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('email', 'test@signalads.com');
        expect(res.body).not.toHaveProperty('password');
    });

    it('deve retornar 401 sem token', async () => {
        const res = await request(app).get('/api/auth/me');
        expect(res.status).toBe(401);
    });

    it('deve retornar 401 com token inválido', async () => {
        const res = await request(app)
            .get('/api/auth/me')
            .set('Authorization', 'Bearer token.invalido.aqui');
        expect(res.status).toBe(401);
    });
});

// ─────────────────────────────────────────────────────────────
// POST /api/auth/register — Bloqueio de broadcaster
// ─────────────────────────────────────────────────────────────
describe('POST /api/auth/register', () => {
    it('deve bloquear auto-cadastro de broadcaster', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({
                email: 'radio@corporativa.com',
                password: 'Senha@123',
                userType: 'broadcaster',
                companyName: 'Rádio Teste FM',
                phone: '11999990000',
            });

        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/administrador/i);
    });

    it('deve bloquear emails gratuitos (gmail)', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({
                email: 'usuario@gmail.com',
                password: 'Senha@123',
                userType: 'advertiser',
                companyName: 'Test Company',
                phone: '11999990000',
            });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/corporativo/i);
    });
});

// ─────────────────────────────────────────────────────────────
// GET /api/health — Health check
// ─────────────────────────────────────────────────────────────
describe('GET /api/health', () => {
    it('deve retornar status ok com DB conectado', async () => {
        const res = await request(app).get('/api/health');

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
        expect(res.body.database.status).toBe('connected');
        expect(res.body).toHaveProperty('uptime');
        expect(res.body).toHaveProperty('memory');
    });
});
