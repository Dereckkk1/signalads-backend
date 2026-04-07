import type { Config } from 'jest';

const config: Config = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
    testMatch: ['**/__tests__/**/*.test.ts'],
    collectCoverageFrom: [
        'src/controllers/**/*.ts',
        'src/utils/**/*.ts',
        'src/middleware/**/*.ts',
        '!src/**/*.d.ts',
        '!src/index.ts',
    ],
    coverageThreshold: {
        global: {
            branches: 8,
            functions: 10,
            lines: 12,
            statements: 12,
        },
        // Thresholds altos para arquivos com testes completos
        './src/middleware/csrf.ts': { branches: 90, functions: 100, lines: 100, statements: 100 },
        './src/middleware/security.ts': { branches: 80, functions: 100, lines: 95, statements: 95 },
        './src/middleware/auth.ts': { branches: 80, functions: 80, lines: 85, statements: 85 },
        './src/utils/freeEmailDomains.ts': { branches: 100, functions: 100, lines: 100, statements: 100 },
        './src/utils/stringUtils.ts': { branches: 100, functions: 100, lines: 100, statements: 100 },
    },
    coverageReporters: ['text', 'text-summary', 'lcov', 'json-summary', 'html'],
    coverageDirectory: 'coverage',
    transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: { esModuleInterop: true } }],
    },
    // setup.ts e importado manualmente nos test files que precisam de MongoDB
    // (via `import '../setup'` ou `import '../../setup'`)
    // Unit tests puros nao precisam de MongoDB e nao importam setup.ts
    moduleNameMapper: {
        '^ioredis$': '<rootDir>/src/__tests__/helpers/mockRedis.ts',
    },
    testTimeout: 30000,
    verbose: true,
};

export default config;
