import type { Config } from 'jest';

/**
 * Dedicated Jest config for the multi-tenancy isolation gate (issue #985).
 *
 * Uses ts-jest `isolatedModules` so only the files under test are transpiled —
 * the full-project type-check program (which OOMs on constrained runners) is
 * skipped. Coverage is disabled and only the tenant-isolation suite is matched.
 */
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/**/tenant-isolation.test.ts'],
  setupFilesAfterEnv: ['<rootDir>/../../jest.setup.ts'],
  collectCoverage: false,
  testTimeout: 30000,
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.json',
        isolatedModules: true,
      },
    ],
  },
};

export default config;