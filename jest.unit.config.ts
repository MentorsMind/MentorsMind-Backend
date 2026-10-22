import type { Config } from "jest";

// Shared by every `transform` entry: ts-jest keeps one ConfigSet per Jest config,
// so the options of the first entry processed are the ones that apply to all of
// them.
// `allowJs` is required so ESM-only dependencies (e.g. uuid@13) get transpiled
// to CommonJS instead of being handed to Jest as raw ESM.
// `isolatedModules` makes ts-jest transpile every file on its own instead of
// emitting through a TypeScript program built from the tsconfig
// `include`/`exclude`. Files outside that program (i.e. everything under
// node_modules) otherwise come back from the language service with a skipped
// emit, and ts-jest falls back to returning the original ESM source unchanged.
// Type checking remains `tsc`'s job (see `build:check`), same as
// jest.config.ts and jest.integration.config.ts.
const tsJestOptions = {
  isolatedModules: true,
  tsconfig: {
    module: "commonjs",
    target: "ES2020",
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    strict: true,
    skipLibCheck: true,
    resolveJsonModule: true,
    allowJs: true,
    types: ["node", "jest"],
  },
};

const config: Config = {
  displayName: "unit",
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/src/**/*.unit.test.ts"],
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
  transform: {
    "^.+\\.tsx?$": ["ts-jest", tsJestOptions],
    "^.+\\.m?js$": ["ts-jest", tsJestOptions],
  },
  // uuid@13 is ESM only, so it has to pass through the transformer.
  transformIgnorePatterns: ["/node_modules/(?!(?:\\.pnpm/)?uuid)"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  collectCoverage: false,
  clearMocks: true,
  restoreMocks: true,
  verbose: true,
};

export default config;
