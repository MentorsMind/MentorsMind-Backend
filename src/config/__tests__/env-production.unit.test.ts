const baseEnv = {
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  DB_PASSWORD: "test",
  JWT_SECRET: "t".repeat(64),
  JWT_REFRESH_SECRET: "t".repeat(64),
  STELLAR_HORIZON_URL: "https://horizon-testnet.stellar.org",
  FILE_SIGNING_SECRET: "t".repeat(64),
  CACHE_KEY_HMAC_SECRET: "t".repeat(64),
  ENCRYPTION_KEY: "t".repeat(64),
  AWS_S3_BUCKET: "test-bucket",
  AWS_ACCESS_KEY_ID: "test-access-key",
  AWS_SECRET_ACCESS_KEY: "test-secret-key",
};

describe("PII_ENCRYPTION_KEYS requirement", () => {
  let envSchema: typeof import("../env").envSchema;

  beforeAll(() => {
    const originalEnv = { ...process.env };
    Object.assign(process.env, baseEnv, { NODE_ENV: "test" });
    jest.doMock("dotenv", () => ({ config: jest.fn() }));
    jest.isolateModules(() => {
      envSchema = require("../env").envSchema;
    });
    jest.dontMock("dotenv");
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, originalEnv);
  });

  it.each(["production", "staging"])("fails in %s when missing", (NODE_ENV) => {
    const result = envSchema.safeParse({ ...baseEnv, NODE_ENV });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes("PII_ENCRYPTION_KEYS"));
      expect(issue?.message).toBe("PII_ENCRYPTION_KEYS is required in production");
    }
  });

  it("throws from parse() in production when missing", () => {
    expect(() => envSchema.parse({ ...baseEnv, NODE_ENV: "production" })).toThrow(
      "PII_ENCRYPTION_KEYS is required in production",
    );
  });

  it("passes in production when provided", () => {
    const result = envSchema.safeParse({ ...baseEnv, NODE_ENV: "production", PII_ENCRYPTION_KEYS: "1:abc" });
    expect(result.success).toBe(true);
  });

  it("stays optional in test/development", () => {
    expect(envSchema.safeParse({ ...baseEnv, NODE_ENV: "test" }).success).toBe(true);
    expect(envSchema.safeParse({ ...baseEnv, NODE_ENV: "development" }).success).toBe(true);
  });
});
