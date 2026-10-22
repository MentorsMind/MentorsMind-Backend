import type { Config } from 'jest';
import baseConfig from './jest.config';

const config: Config = {
  ...baseConfig,
  testMatch: ['<rootDir>/tests/integration/**/*.test.ts'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testTimeout: 60000,
  collectCoverage: false,
  // Integration tests exercise real services end-to-end; type-checking is
  // `tsc`'s job, so transpile only and don't fail on unrelated type errors.
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json', isolatedModules: true }],
  },
};

export default config;
