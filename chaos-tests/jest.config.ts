import type { Config } from "jest";

const config: Config = {
  displayName: "chaos",
  rootDir: "..",
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/chaos-tests/**/*.test.ts"],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          module: "commonjs",
          target: "ES2020",
          esModuleInterop: true,
          strict: true,
          skipLibCheck: true,
          types: ["node", "jest"],
        },
      },
    ],
  },
  collectCoverage: false,
  clearMocks: true,
};

export default config;