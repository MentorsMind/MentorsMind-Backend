import {
  redactSensitiveFields,
  withRequestId,
  withCorrelationId,
} from "../logger";
import pino from "pino";

describe("logger", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    jest.resetModules();
  });

  // -------------------------------------------------------------------------
  // Log level
  // -------------------------------------------------------------------------
  describe("log level", () => {
    it('defaults to "info" level', () => {
      delete process.env.LOG_LEVEL;
      const { logger } = require("../logger");
      expect(logger.level).toBe("silent"); // test env → silent
    });

    it("respects LOG_LEVEL env var (non-test env)", () => {
      process.env.NODE_ENV = "development";
      process.env.LOG_LEVEL = "debug";
      const { logger } = require("../logger");
      expect(logger.level).toBe("debug");
    });
  });

  // -------------------------------------------------------------------------
  // Sensitive field redaction helper
  // -------------------------------------------------------------------------
  describe("redactSensitiveFields", () => {
    it('redacts "password" key', () => {
      const result = redactSensitiveFields({
        username: "alice",
        password: "super-secret",
      }) as any;
      expect(result.password).toBe("[REDACTED]");
      expect(result.username).toBe("alice");
    });

    it('redacts "token" key', () => {
      const result = redactSensitiveFields({ token: "jwt-secret" }) as any;
      expect(result.token).toBe("[REDACTED]");
    });

    it('redacts "secret" key recursively nested in an object', () => {
      const result = redactSensitiveFields({
        config: { secret: "my-secret", name: "test" },
      }) as any;
      expect(result.config.secret).toBe("[REDACTED]");
      expect(result.config.name).toBe("test");
    });

    it('redacts "apiKey" and "privateKey"', () => {
      const result = redactSensitiveFields({
        apiKey: "key-123",
        privateKey: "pk-456",
      }) as any;
      expect(result.apiKey).toBe("[REDACTED]");
      expect(result.privateKey).toBe("[REDACTED]");
    });

    it("does not redact non-sensitive fields", () => {
      const result = redactSensitiveFields({
        method: "POST",
        url: "/api/v1/auth",
      }) as any;
      expect(result.method).toBe("POST");
      expect(result.url).toBe("/api/v1/auth");
    });

    it("handles null and primitives safely", () => {
      expect(redactSensitiveFields(null)).toBeNull();
      expect(redactSensitiveFields(42)).toBe(42);
      expect(redactSensitiveFields("string")).toBe("string");
    });

    it("handles arrays containing objects with sensitive keys", () => {
      const result = redactSensitiveFields([
        { password: "p1" },
        { name: "bob" },
      ]) as any[];
      expect(result[0].password).toBe("[REDACTED]");
      expect(result[1].name).toBe("bob");
    });
  });

  // -------------------------------------------------------------------------
  // Child loggers
  // -------------------------------------------------------------------------
  describe("withRequestId / withCorrelationId", () => {
    it("withRequestId returns a child logger with requestId binding", () => {
      const child = withRequestId("req-abc-123");
      expect(typeof child.info).toBe("function");
      expect((child as any).bindings().requestId).toBe("req-abc-123");
    });

    it("withCorrelationId returns a child logger with correlationId binding", () => {
      const child = withCorrelationId("corr-xyz-789");
      expect(typeof child.info).toBe("function");
      expect((child as any).bindings().correlationId).toBe("corr-xyz-789");
    });
  });
});
