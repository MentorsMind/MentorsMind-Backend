import type { Config } from "jest";

/**
 * Jest configuration for integration tests.
 *
 * - Matches files ending in *.integration.test.ts anywhere under src/
 * - Spins up real PostgreSQL and Redis via testcontainers (globalSetup)
 * - Runs --runInBand so containers are shared and tests are sequential
 * - Resets DB and Redis before every test (integrationSetup.ts)
 */
const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: ".",
  roots: ["<rootDir>/src"],

  // Only pick up integration test files
  testMatch: ["**/*.integration.test.ts"],

  // One-time container lifecycle wired to the main Jest process
  globalSetup: "<rootDir>/src/__tests__/setup/globalSetup.ts",
  globalTeardown: "<rootDir>/src/__tests__/setup/globalTeardown.ts",

  // Per-file setup: truncate DB + flush Redis before each test
  setupFilesAfterEnv: ["<rootDir>/src/__tests__/setup/integrationSetup.ts"],

  // TypeScript compilation via ts-jest
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: {
          target: "ES2022",
          module: "commonjs",
          lib: ["ES2022"],
          strict: false,
          esModuleInterop: true,
          skipLibCheck: true,
          forceConsistentCasingInFileNames: true,
          resolveJsonModule: true,
          allowSyntheticDefaultImports: true,
        },
        diagnostics: false,
      },
    ],
  },

  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],

  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    // uuid mock used by unit tests is NOT needed here – skip it so integration
    // tests get real UUIDs from the database.
  },

  // Must run serially: containers are shared across files
  // (pass --runInBand on the CLI as well)
  maxWorkers: 1,

  // Integration tests are slower – give them more time
  testTimeout: 60_000,

  clearMocks: true,
  restoreMocks: true,
  // Keep module cache across files so the pg Pool and Redis client persist
  resetModules: false,

  verbose: true,
  forceExit: true,
  detectOpenHandles: true,
};

export default config;
