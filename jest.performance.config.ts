import type { Config } from "jest";

const config: Config = {
  displayName: "performance",
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/performance/**/*.test.ts"],
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.json" }],
  },
  collectCoverage: false,
};

export default config;