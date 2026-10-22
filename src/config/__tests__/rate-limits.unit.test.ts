describe("rate limit environment validation", () => {
  const originalEnv = { ...process.env };
  const validEnvironment = {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://localhost:5432/test",
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

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
    jest.restoreAllMocks();
    jest.dontMock("dotenv");
  });

  function loadWithRateLimitEnv(windowMs: string, maxRequests: string): string {
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
    Object.assign(process.env, {
      ...validEnvironment,
      RATE_LIMIT_WINDOW_MS: windowMs,
      RATE_LIMIT_MAX_REQUESTS: maxRequests,
    });
    jest.doMock("dotenv", () => ({ config: jest.fn() }));
    const stderrWrite = jest
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    jest.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);

    try {
      jest.isolateModules(() => {
        require("../env");
      });
    } catch (error) {
      expect((error as Error).message).toBe("process.exit called");
    }

    return stderrWrite.mock.calls.map(([message]) => String(message)).join("");
  }

  it("rejects RATE_LIMIT_WINDOW_MS=0 at startup", () => {
    const startupError = loadWithRateLimitEnv("0", "100");

    expect(startupError).toContain(
      "RATE_LIMIT_WINDOW_MS: Must be at least 1000ms",
    );
  });

  it("rejects max request limits above 10000 at startup", () => {
    const startupError = loadWithRateLimitEnv("900000", "10001");

    expect(startupError).toContain(
      "RATE_LIMIT_MAX_REQUESTS: Must be between 1 and 10000",
    );
  });

  it("rejects max request limits below 1 at startup", () => {
    const startupError = loadWithRateLimitEnv("900000", "0");

    expect(startupError).toContain(
      "RATE_LIMIT_MAX_REQUESTS: Must be between 1 and 10000",
    );
  });
});
