const BASE_ENV = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  DB_PASSWORD: "test",
  JWT_SECRET: "t".repeat(64),
  JWT_REFRESH_SECRET: "t".repeat(64),
  STELLAR_HORIZON_URL: "https://horizon-testnet.stellar.org",
  FILE_SIGNING_SECRET: "t".repeat(64),
  ENCRYPTION_KEY: "t".repeat(64),
  AWS_S3_BUCKET: "test-bucket",
  AWS_ACCESS_KEY_ID: "test-access-key",
  AWS_SECRET_ACCESS_KEY: "test-secret-key",
};

function loadEnv(overrides: Record<string, string>) {
  const original = { ...process.env };
  Object.assign(process.env, BASE_ENV, overrides);
  jest.doMock("dotenv", () => ({ config: jest.fn() }));
  const stderr = jest.spyOn(process.stderr, "write").mockImplementation(() => true);
  const exit = jest
    .spyOn(process, "exit")
    .mockImplementation((() => {
      throw new Error("process.exit");
    }) as never);

  try {
    let parsed: any;
    let error: unknown;
    jest.isolateModules(() => {
      try {
        parsed = require("../env").env;
      } catch (e) {
        error = e;
      }
    });
    return { parsed, error, stderr: stderr.mock.calls.map((c) => String(c[0])).join("") };
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, original);
    stderr.mockRestore();
    exit.mockRestore();
    jest.dontMock("dotenv");
  }
}

describe("rate limit env validation", () => {
  it("rejects RATE_LIMIT_WINDOW_MS=0 with a clear error", () => {
    const { error, stderr } = loadEnv({ RATE_LIMIT_WINDOW_MS: "0" });
    expect((error as Error).message).toBe("process.exit");
    expect(stderr).toContain("RATE_LIMIT_WINDOW_MS");
    expect(stderr).toContain("at least 1000ms");
  });

  it("rejects RATE_LIMIT_WINDOW_MS below 1000", () => {
    expect(loadEnv({ RATE_LIMIT_WINDOW_MS: "999" }).error).toBeDefined();
  });

  it("rejects RATE_LIMIT_MAX_REQUESTS=0", () => {
    const { error, stderr } = loadEnv({ RATE_LIMIT_MAX_REQUESTS: "0" });
    expect(error).toBeDefined();
    expect(stderr).toContain("RATE_LIMIT_MAX_REQUESTS must be at least 1");
  });

  it("accepts the minimum valid bounds", () => {
    const { error, parsed } = loadEnv({
      RATE_LIMIT_WINDOW_MS: "1000",
      RATE_LIMIT_MAX_REQUESTS: "1",
    });
    expect(error).toBeUndefined();
    expect(parsed.RATE_LIMIT_WINDOW_MS).toBe("1000");
  });
});
