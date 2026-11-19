describe("environment validation", () => {
  it("warns and disables backup alerts for an invalid admin email", () => {
    const originalEnv = { ...process.env };
    const stderrWrite = jest
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    Object.assign(process.env, {
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
      ADMIN_ALERT_EMAIL: "admin",
    });
    jest.doMock("dotenv", () => ({ config: jest.fn() }));

    try {
      let parsedEnv: { ADMIN_ALERT_EMAIL?: string };
      jest.isolateModules(() => {
        parsedEnv = require("../env").env;
      });

      expect(parsedEnv!.ADMIN_ALERT_EMAIL).toBeUndefined();
      expect(stderrWrite).toHaveBeenCalledWith(
        expect.stringContaining("ADMIN_ALERT_EMAIL is invalid"),
      );
    } finally {
      for (const key of Object.keys(process.env)) {
        delete process.env[key];
      }
      Object.assign(process.env, originalEnv);
      stderrWrite.mockRestore();
      jest.dontMock("dotenv");
    }
  });
});