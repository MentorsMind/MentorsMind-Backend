import type { Config } from "jest";

/**
 * Jest config for unit tests that don't require a database connection.
 * Used for queue, worker, logging, database, and env config unit tests.
 */
const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: ".",
  roots: ["<rootDir>/src"],
  testMatch: [
    "**/__tests__/unit/**/*.test.ts",
    "**/__tests__/**/*.unit.test.ts",
    "**/queues/__tests__/**/*.test.ts",
    "**/workers/__tests__/**/*.test.ts",
    // Logging infrastructure unit tests (no DB required)
    "**/utils/__tests__/logger.test.ts",
    "**/middleware/__tests__/correlation-id.middleware.test.ts",
    "**/middleware/__tests__/request-logger.middleware.test.ts",
    "**/middleware/__tests__/idempotency.middleware.test.ts",
    // Database unit tests (no live DB — all mocked)
    "**/utils/__tests__/database.utils.test.ts",
    "**/utils/__tests__/pool-monitor.utils.test.ts",
    "**/services/__tests__/database.service.test.ts",
    // Environment config unit tests
    "**/config/__tests__/env.test.ts",
    "**/config/__tests__/database-pool.config.test.ts",
    // Session reminder and verification unit tests
    "**/__tests__/jobs/**/*.unit.test.ts",
    "**/__tests__/services/**/*.unit.test.ts",
    "**/services/__tests__/unit/bulk.service.test.ts",
  ],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: {
          target: "ES2022",
          module: "commonjs",
          strict: false,
          esModuleInterop: true,
          skipLibCheck: true,
          allowSyntheticDefaultImports: true,
        },
        diagnostics: false,
      },
    ],
  },
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^uuid$": "<rootDir>/src/tests/mocks/uuid.ts",
  },
  setupFilesAfterEnv: ["<rootDir>/src/tests/jest.setup.ts"],
  clearMocks: true,
  resetModules: true,
  restoreMocks: true,
  verbose: true,
  forceExit: true,
  testTimeout: 30000,
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.d.ts",
    "!src/**/index.ts",
    "!src/tests/**",
    "!src/docs/**",
    "src/services/auth.service.ts",
    "src/services/payments.service.ts",
    "src/services/bookings.service.ts",
    "src/services/notification.service.ts",
    "src/services/search.service.ts",
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html", "json-summary"],
  coverageThreshold: {
    global: {
      lines: 80,
      statements: 80,
      branches: 70,
      functions: 80,
    },
  },
};

export default config;
