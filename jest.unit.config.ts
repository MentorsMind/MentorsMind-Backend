import type { Config } from 'jest';

/**
 * Jest config for unit tests that don't require a database connection.
 * Used for queue and worker tests.
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
};

export default config;
