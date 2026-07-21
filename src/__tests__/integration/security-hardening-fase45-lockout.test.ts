/**
 * Integration Tests — Lockout de conta (item 4.5 do plano 2026-07-20)
 *
 * O rate limit do /login e chaveado por (IP | e-mail). Um atacante que
 * ROTACIONA e-mails — credential stuffing / password spraying, que e o
 * padrao real — nunca atinge o teto por par: cada par novo comeca do zero.
 * O lockout por CONTA e a segunda linha de defesa.
 *
 * Nota: o rate limiter fica inativo em NODE_ENV=test (ver authRoutes), entao
 * estes testes exercitam o lockout isoladamente, que e o objetivo.
 */

import '../helpers/mocks';

import request from 'supertest';
import { Application } from 'express';

import { createTestApp } from '../helpers/createTestApp';
import { connectTestDB, clearTestDB, disconnectTestDB } from '../helpers/setup';
import { createAdvertiser } from '../helpers/authHelper';
import { User, MAX_FAILED_LOGIN_ATTEMPTS } from '../../models/User';

let app: Application;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret-key-for-testing-12345';
  process.env.NODE_ENV = 'test';
  await connectTestDB();
  app = createTestApp();
});

afterEach(async () => {
  await clearTestDB();
});

afterAll(async () => {
  await disconnectTestDB();
});

const SENHA_CORRETA = 'SenhaForte@123';

async function contaDeTeste() {
  const { user } = await createAdvertiser({ password: SENHA_CORRETA } as any);
  return user;
}

const tentarLogin = (email: string, senha: string) =>
  request(app).post('/api/auth/login').send({ emailOrCnpj: email, password: senha });

describe('4.5 — lockout de conta apos falhas consecutivas', () => {
  it('conta o numero de falhas no documento do usuario', async () => {
    const user = await contaDeTeste();

    await tentarLogin(user.email, 'SenhaErrada@1');
    await tentarLogin(user.email, 'SenhaErrada@2');

    const atualizado = await User.findById(user._id).select('+failedLoginAttempts');
    expect(atualizado!.failedLoginAttempts).toBe(2);
  });

  it('SEGURANCA: bloqueia a conta ao atingir o teto de tentativas', async () => {
    const user = await contaDeTeste();

    for (let i = 0; i < MAX_FAILED_LOGIN_ATTEMPTS; i++) {
      await tentarLogin(user.email, `SenhaErrada@${i}`);
    }

    const atualizado = await User.findById(user._id).select('+lockUntil');
    expect(atualizado!.lockUntil).toBeInstanceOf(Date);
    expect(atualizado!.lockUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it('SEGURANCA: senha CORRETA nao autentica enquanto a conta esta bloqueada', async () => {
    const user = await contaDeTeste();

    for (let i = 0; i < MAX_FAILED_LOGIN_ATTEMPTS; i++) {
      await tentarLogin(user.email, `SenhaErrada@${i}`);
    }

    const res = await tentarLogin(user.email, SENHA_CORRETA);

    expect(res.status).toBe(401);
    // Resposta identica a de credencial invalida: dizer "conta bloqueada"
    // confirmaria a existencia da conta para quem nao tem a senha.
    expect(res.body.error).toBe('Credenciais inválidas');
  });

  it('login bem-sucedido zera o contador de falhas', async () => {
    const user = await contaDeTeste();

    await tentarLogin(user.email, 'SenhaErrada@1');
    await tentarLogin(user.email, 'SenhaErrada@2');
    await tentarLogin(user.email, SENHA_CORRETA);

    const atualizado = await User.findById(user._id).select('+failedLoginAttempts +lockUntil');
    expect(atualizado!.failedLoginAttempts).toBe(0);
    expect(atualizado!.lockUntil).toBeUndefined();
  });

  it('bloqueio expira: com lockUntil no passado, a senha correta volta a funcionar', async () => {
    const user = await contaDeTeste();

    await User.updateOne(
      { _id: user._id },
      { $set: { lockUntil: new Date(Date.now() - 60_000), failedLoginAttempts: 0 } }
    );

    const res = await tentarLogin(user.email, SENHA_CORRETA);
    expect(res.status).not.toBe(401);
  });

  it('o bloqueio e POR CONTA — outra conta continua acessivel', async () => {
    const vitima = await contaDeTeste();
    const { user: outra } = await createAdvertiser({ password: SENHA_CORRETA } as any);

    for (let i = 0; i < MAX_FAILED_LOGIN_ATTEMPTS; i++) {
      await tentarLogin(vitima.email, `SenhaErrada@${i}`);
    }

    const res = await tentarLogin(outra.email, SENHA_CORRETA);
    expect(res.status).not.toBe(401);
  });
});
