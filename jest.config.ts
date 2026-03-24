import type { Config } from 'jest';

const config: Config = {
  // Use ts-jest for TypeScript support
  preset: 'ts-jest',

  // Test environment
  testEnvironment: 'node',

  // Root directory for tests
  rootDir: '.',

  // Where to find test files
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],

  // Coverage configuration
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
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },

  // Module file extensions
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],

  // Transform configuration
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          target: 'ES2022',
          module: 'commonjs',
          lib: ['ES2022'],
          strict: false,
          esModuleInterop: true,
          skipLibCheck: true,
          forceConsistentCasingInFileNames: true,
          resolveJsonModule: true,
          allowSyntheticDefaultImports: true,
        },
      },
    ],
  },

  // Setup files
  setupFilesAfterEnv: ['<rootDir>/src/tests/setup.ts'],

  // Clear mocks between tests
  clearMocks: true,

  // Reset modules between tests
  resetModules: true,

  // Restore mocks after each test
  restoreMocks: true,

  // Verbose output
  verbose: true,

  // Force exit after tests complete
  forceExit: true,

  // Detect open handles
  detectOpenHandles: true,

  // Test timeout (30 seconds)
  testTimeout: 30000,

  // Map imports
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};

export default config;
