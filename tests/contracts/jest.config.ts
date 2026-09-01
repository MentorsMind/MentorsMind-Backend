import type { Config } from 'jest';

const config: Config = {
  displayName: 'contract',
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/contracts/**/*.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          target: 'ES2020',
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          strict: true,
          skipLibCheck: true,
          resolveJsonModule: true,
          types: ['node', 'jest'],
        },
        diagnostics: {
          ignoreCodes: [1343, 2345, 7006],
        },
      },
    ],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  // Ensure we fail fast in CI
  bail: process.env.CI === 'true' ? 1 : 0,
  verbose: true,
  forceExit: true,
};

export default config;
