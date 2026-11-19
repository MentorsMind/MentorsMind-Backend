import type { Config } from "jest";

const config: Config = {
  displayName: "database-migrations",
  rootDir: "../..",
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/database/tests/**/*.test.ts"],
  transform: { "^.+\\.tsx?$": ["ts-jest", { tsconfig: { module: "commonjs", target: "ES2020", esModuleInterop: true, strict: true, skipLibCheck: true, types: ["node", "jest"] } }] },
  collectCoverage: false,
};

export default config;