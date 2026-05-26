import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: ".",
  roots: ["<rootDir>/src/websocket"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
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
          resolveJsonModule: true,
          allowSyntheticDefaultImports: true,
        },
      },
    ],
  },
  setupFilesAfterEnv: ["<rootDir>/src/websocket/__tests__/jest.setup.ts"],
  transformIgnorePatterns: ["node_modules/(?!(uuid)/)"],
  clearMocks: true,
  resetModules: true,
  restoreMocks: true,
  verbose: true,
  forceExit: true,
  detectOpenHandles: true,
  testTimeout: 30000,
};

export default config;
