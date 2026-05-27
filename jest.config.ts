import type { Config } from "jest";

const config: Config = {
  // Use ts-jest for TypeScript support
  preset: "ts-jest",

  // Test environment
  testEnvironment: "node",

  // Root directory for tests
  rootDir: ".",

  // Where to find test files
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  // Integration tests have their own config (jest.integration.config.ts)
  testPathIgnorePatterns: ["/node_modules/", "\\.integration\\.test\\.ts$"],

  // Coverage configuration
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.d.ts",
    "!src/**/index.ts",
    "!src/tests/**",
    "!src/docs/**",
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html", "json-summary"],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
    // Critical services require 90% coverage
    "./src/services/auth.service.ts": {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
    "./src/services/payments.service.ts": {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
    "./src/services/sorobanEscrow.service.ts": {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
    "./src/services/escrow-api.service.ts": {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },

  // Module file extensions
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],

  // Transform configuration
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        diagnostics: false,
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
      },
    ],
  },

  // Setup files
  setupFilesAfterEnv: ["<rootDir>/src/tests/setup.ts"],

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
    "^@/(.*)$": "<rootDir>/src/$1",
    "^uuid$": "<rootDir>/src/tests/mocks/uuid.ts",
  },
};

export default config;
