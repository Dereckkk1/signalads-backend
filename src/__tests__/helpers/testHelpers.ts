/**
 * Factory functions e helpers para testes.
 * Gera dados de teste, tokens JWT e objetos mock de request/response.
 */

import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { Request, Response, NextFunction } from 'express';
import { User } from '../../models/User';

// ─── Constantes ────────────────────────────────────────────────
export const TEST_JWT_SECRET = 'test-secret-key-for-testing-12345';
const BCRYPT_ROUNDS = 4; // Rapido para testes

// ─── Tipos ─────────────────────────────────────────────────────
interface CreateUserOptions {
    email?: string;
    password?: string;
    userType?: 'advertiser' | 'agency' | 'broadcaster' | 'admin';
    companyName?: string;
    fantasyName?: string;
    phone?: string;
    cpfOrCnpj?: string;
    cnpj?: string;
    status?: 'pending' | 'approved' | 'rejected';
    emailConfirmed?: boolean;
    twoFactorEnabled?: boolean;
    [key: string]: any;
}

// ─── Factory: User ─────────────────────────────────────────────
export async function createTestUser(overrides: CreateUserOptions = {}) {
    const defaults: CreateUserOptions = {
        email: `test-${Date.now()}@signalads.com`,
        password: await bcrypt.hash('Senha@123', BCRYPT_ROUNDS),
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
}

export async function createTestAdmin(overrides: CreateUserOptions = {}) {
    return createTestUser({
        email: `admin-${Date.now()}@signalads.com`,
        userType: 'admin',
        companyName: 'SignalAds Admin',
        ...overrides,
    });
}

export async function createTestBroadcaster(overrides: CreateUserOptions = {}) {
    return createTestUser({
        email: `radio-${Date.now()}@emissora.com`,
        userType: 'broadcaster',
        companyName: 'Radio Teste FM',
        ...overrides,
    });
}

// ─── JWT Helper ────────────────────────────────────────────────
export function generateTestToken(userId: string, secret?: string): string {
    return jwt.sign(
        { userId },
        secret || process.env.JWT_SECRET || TEST_JWT_SECRET,
        { expiresIn: '15m' }
    );
}

export function generateExpiredToken(userId: string): string {
    return jwt.sign(
        { userId },
        process.env.JWT_SECRET || TEST_JWT_SECRET,
        { expiresIn: '0s' }
    );
}

// ─── Mock ObjectId ─────────────────────────────────────────────
export function randomObjectId(): string {
    return new mongoose.Types.ObjectId().toString();
}

// ─── Mock Request/Response/Next ────────────────────────────────
export interface MockResponse {
    statusCode: number;
    jsonData: any;
    cookies: Record<string, { value: string; options: any }>;
    clearedCookies: Record<string, any>;
    headers: Record<string, string>;
    status: (code: number) => MockResponse;
    json: (data: any) => MockResponse;
    cookie: (name: string, value: string, options?: any) => MockResponse;
    clearCookie: (name: string, options?: any) => MockResponse;
    setHeader: (name: string, value: string) => MockResponse;
    send: (data?: any) => MockResponse;
    end: () => MockResponse;
}

export function createMockResponse(): MockResponse {
    const res: MockResponse = {
        statusCode: 200,
        jsonData: null,
        cookies: {},
        clearedCookies: {},
        headers: {},
        status(code: number) {
            res.statusCode = code;
            return res;
        },
        json(data: any) {
            res.jsonData = data;
            return res;
        },
        cookie(name: string, value: string, options?: any) {
            res.cookies[name] = { value, options: options || {} };
            return res;
        },
        clearCookie(name: string, options?: any) {
            res.clearedCookies[name] = options || {};
            return res;
        },
        setHeader(name: string, value: string) {
            res.headers[name] = value;
            return res;
        },
        send(_data?: any) {
            return res;
        },
        end() {
            return res;
        },
    };
    return res;
}

export interface MockRequest {
    method: string;
    path: string;
    body: any;
    query: any;
    params: any;
    headers: Record<string, string | undefined>;
    cookies: Record<string, string | undefined>;
    ip: string;
    route?: any;
    userId?: string;
    user?: any;
    [key: string]: any;
}

export function createMockRequest(overrides: Partial<MockRequest> = {}): MockRequest {
    return {
        method: 'GET',
        path: '/api/test',
        body: {},
        query: {},
        params: {},
        headers: {},
        cookies: {},
        ip: '127.0.0.1',
        ...overrides,
    };
}

export function createMockNext(): NextFunction & jest.Mock {
    return jest.fn() as NextFunction & jest.Mock;
}
