import type { Config } from 'jest';

/**
 * Jest config for contract testing against OpenAPI spec
 * Validates that API responses match the OpenAPI schema
 */
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.contract.test.ts'],
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
  setupFilesAfterEnv: ['<rootDir>/src/tests/setup.ts'],
  clearMocks: true,
  resetModules: true,
  restoreMocks: true,
  verbose: true,
  testTimeout: 30000,
};

export default config;
