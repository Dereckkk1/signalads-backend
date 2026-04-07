/**
 * Auth Test Helper
 *
 * Provides functions to create test users and generate auth cookies
 * for integration tests with supertest.
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from '../../models/User';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-testing-12345';

// A strong password that meets all validation rules
export const STRONG_PASSWORD = 'TestPass123!@#';

export interface TestUserOptions {
  name?: string;
  email?: string;
  password?: string;
  userType?: 'admin' | 'broadcaster' | 'advertiser' | 'agency';
  status?: 'pending' | 'approved' | 'rejected';
  emailConfirmed?: boolean;
  companyName?: string;
  fantasyName?: string;
  phone?: string;
  cpfOrCnpj?: string;
  cnpj?: string;
  broadcasterProfile?: Record<string, any>;
  address?: Record<string, any>;
  onboardingCompleted?: boolean;
  isCatalogOnly?: boolean;
}

export interface AuthCookies {
  accessToken: string;
  csrfToken: string;
  cookieHeader: string[];
  csrfHeader: string;
}

/**
 * Generates a valid JWT access token for the given userId.
 */
export function generateTestToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '15m' });
}

/**
 * Creates a user directly in MongoDB and returns the user document.
 * Password is hashed with bcrypt as the real app does.
 */
export async function createTestUser(options: TestUserOptions = {}) {
  const {
    name = 'Test User',
    email = `test-${Date.now()}@empresa.com.br`,
    password = STRONG_PASSWORD,
    userType = 'advertiser',
    status = 'approved',
    emailConfirmed = true,
    companyName = 'Test Company',
    fantasyName = 'Test Fantasy',
    phone = '11999999999',
    cpfOrCnpj = '12345678901234',
    cnpj,
    broadcasterProfile,
    address,
    onboardingCompleted = false,
    isCatalogOnly = false,
  } = options;

  const hashedPassword = await bcrypt.hash(password, 4); // low cost for speed in tests

  const userData: Record<string, any> = {
    name,
    email,
    password: hashedPassword,
    userType,
    status,
    emailConfirmed,
    companyName,
    fantasyName,
    phone,
    cpfOrCnpj,
    onboardingCompleted,
    isCatalogOnly,
  };

  if (cnpj) userData.cnpj = cnpj;
  if (broadcasterProfile) userData.broadcasterProfile = broadcasterProfile;
  if (address) userData.address = address;

  const user = await User.create(userData);
  return user;
}

/**
 * Creates a test user and returns auth cookies + CSRF header ready
 * to be used with supertest .set('Cookie', ...) and .set('X-CSRF-Token', ...).
 */
export async function createAuthenticatedUser(
  options: TestUserOptions = {}
): Promise<{ user: any; auth: AuthCookies }> {
  const user = await createTestUser(options);
  const auth = generateAuthCookies(user._id.toString());
  return { user, auth };
}

/**
 * Given a userId, returns cookie and CSRF headers for supertest.
 */
export function generateAuthCookies(userId: string): AuthCookies {
  const accessToken = generateTestToken(userId);
  const csrfToken = 'test-csrf-token';

  return {
    accessToken,
    csrfToken,
    cookieHeader: [
      `access_token=${accessToken}`,
      `csrf_token=${csrfToken}`,
    ],
    csrfHeader: csrfToken,
  };
}

// ----- Convenience factories for each role -----

export async function createAdmin(overrides: Partial<TestUserOptions> = {}) {
  return createAuthenticatedUser({
    userType: 'admin',
    status: 'approved',
    email: `admin-${Date.now()}@empresa.com.br`,
    companyName: 'Admin Co',
    ...overrides,
  });
}

export async function createBroadcaster(overrides: Partial<TestUserOptions> = {}) {
  return createAuthenticatedUser({
    userType: 'broadcaster',
    status: 'approved',
    email: `broadcaster-${Date.now()}@emissora.com.br`,
    companyName: 'Radio Test FM',
    cnpj: '12345678000199',
    onboardingCompleted: true,
    address: {
      cep: '01001000',
      street: 'Rua Teste',
      number: '100',
      neighborhood: 'Centro',
      city: 'São Paulo',
      state: 'SP',
      latitude: -23.55,
      longitude: -46.63,
    },
    broadcasterProfile: {
      generalInfo: {
        stationName: 'Radio Test FM',
        dialFrequency: '100.1',
        band: 'FM',
      },
      categories: ['Popular'],
      coverage: {
        states: ['SP'],
        cities: ['São Paulo (0km)'],
        totalPopulation: 12000000,
      },
    },
    ...overrides,
  });
}

export async function createAdvertiser(overrides: Partial<TestUserOptions> = {}) {
  return createAuthenticatedUser({
    userType: 'advertiser',
    status: 'approved',
    email: `advertiser-${Date.now()}@empresa.com.br`,
    companyName: 'Advertiser Co',
    ...overrides,
  });
}

export async function createAgency(overrides: Partial<TestUserOptions> = {}) {
  return createAuthenticatedUser({
    userType: 'agency',
    status: 'approved',
    email: `agency-${Date.now()}@agencia.com.br`,
    companyName: 'Agency Co',
    ...overrides,
  });
}
