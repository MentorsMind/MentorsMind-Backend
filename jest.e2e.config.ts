import type { Config } from 'jest';

const config: Config = {
  displayName: 'e2e',
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Only pick up E2E test files
  testMatch: ['**/tests/e2e/**/*.e2e.ts'],
  // Exclude unit/validator tests
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/src/validators/__tests__/'],
  // ts-jest transform configuration
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
          // Ignore type-only errors during tests to keep developer experience clean
          ignoreCodes: [1343, 2345, 7006],
        },
      },
    ],
  },
  // Global setup: boot containers once before all suites
  globalSetup: './tests/e2e/setup/global-setup.ts',
  // Global teardown: kill containers after all suites
  globalTeardown: './tests/e2e/setup/global-teardown.ts',
  // E2E tests run sequentially — Docker I/O and DB state would conflict if parallelised
  maxWorkers: 1,
  // Each suite can take up to 4 min (container start included in global setup)
  testTimeout: 240_000,
  // Verbose output for CI readability
  verbose: true,
  // Fail fast in CI — stop on first suite failure
  bail: process.env.CI === 'true' ? 1 : 0,
  // Module name mapper — allow bare imports used by the main app
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  // Collect coverage only when explicitly requested
  collectCoverage: false,
  coverageDirectory: 'coverage-e2e',
  coverageReporters: ['text', 'lcov'],
  // Avoid touching the src/__tests__ coverage from unit runs
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/', '/tests/e2e/'],
  // Force Jest to exit after all tests complete (prevents hanging due to open handles)
  forceExit: true,
  // Detect open handles in non-CI environments for debugging
  detectOpenHandles: process.env.CI !== 'true',
  // Generate HTML test execution report
  reporters: [
    'default',
    [
      'jest-html-reporter',
      {
        pageTitle: 'MentorsMind E2E Test Report',
        outputPath: './reports/e2e-report.html',
        includeFailureMsg: true,
        includeConsoleLog: true,
      },
    ],
  ],
};

export default config;
