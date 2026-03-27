import type { Config } from 'jest';

/**
 * Jest config for unit tests that don't require a database connection.
 * Used for queue, worker, logging, database, and env config unit tests.
 */
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testMatch: [
    '**/__tests__/**/*.unit.test.ts',
    '**/queues/__tests__/**/*.test.ts',
    '**/workers/__tests__/**/*.test.ts',
    // Logging infrastructure unit tests (no DB required)
    '**/utils/__tests__/logger.test.ts',
    '**/middleware/__tests__/correlation-id.middleware.test.ts',
    '**/middleware/__tests__/request-logger.middleware.test.ts',
    // Database unit tests (no live DB — all mocked)
    '**/utils/__tests__/database.utils.test.ts',
    '**/services/__tests__/database.service.test.ts',
    // Environment config unit tests
    '**/config/__tests__/env.test.ts',
    // Session reminder and verification unit tests
    '**/__tests__/jobs/**/*.unit.test.ts',
    '**/__tests__/services/**/*.unit.test.ts',
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          target: 'ES2022',
          module: 'commonjs',
          strict: false,
          esModuleInterop: true,
          skipLibCheck: true,
          allowSyntheticDefaultImports: true,
        },
      },
    ],
  },
  clearMocks: true,
  resetModules: true,
  restoreMocks: true,
  verbose: true,
  forceExit: true,
  testTimeout: 30000,
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
    '!src/tests/**',
    '!src/docs/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html', 'json-summary'],
  coverageThreshold: {
    global: {
      statements: 80,
      branches: 75,
      functions: 80,
    },
  },
};

export default config;
