import pino, { type Bindings, type ChildLoggerOptions } from "pino";
import os from "os";
import { env } from "../config/env";

// ---------------------------------------------------------------------------
// Sensitive-field redaction paths (pino built-in redaction)
// ---------------------------------------------------------------------------
const REDACT_PATHS = [
  "password",
  "token",
  "secret",
  "secretKey",
  "authorization",
  "refreshToken",
  "apiKey",
  "privateKey",
  "*.password",
  "*.token",
  "*.secret",
  "*.secretKey",
  "*.authorization",
  "*.refreshToken",
  "*.apiKey",
  "*.privateKey",
  "req.headers.authorization",
  "req.body.password",
  "req.body.token",
];

const IS_PRODUCTION = env.NODE_ENV === "production";
const IS_TEST = env.NODE_ENV === "test";
const LOG_LEVEL = env.LOG_LEVEL;

import { traceStore } from "../middleware/tracing.middleware";

/**
 * Stable identifier for this process/pod.
 */
export const INSTANCE_ID: string =
  env.INSTANCE_ID ||
  os.hostname() ||
  `instance-${Math.random().toString(36).slice(2, 8)}`;

type StructuredLogPayload = Record<string, unknown>;

type StructuredLogMethod = {
  (msg: string, payload?: StructuredLogPayload, ...args: unknown[]): void;
  (payload: StructuredLogPayload): void;
};

type StructuredLogger = pino.Logger & {
  fatal: StructuredLogMethod;
  error: StructuredLogMethod;
  warn: StructuredLogMethod;
  info: StructuredLogMethod;
  debug: StructuredLogMethod;
  trace: StructuredLogMethod;
  silent: StructuredLogMethod;
  child: (bindings: Bindings, options?: ChildLoggerOptions) => StructuredLogger;
};

const isStructuredLogPayload = (
  value: unknown,
): value is StructuredLogPayload =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  !(value instanceof Error);

function wrapStructuredLogger(baseLogger: pino.Logger): StructuredLogger {
  const wrappedLogger = baseLogger as StructuredLogger;
  const originalChild = baseLogger.child.bind(baseLogger);

  const wrapMethod = (
    level: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent",
  ) => {
    const originalMethod = baseLogger[level].bind(baseLogger);

    wrappedLogger[level] = ((
      first: unknown,
      second?: unknown,
      ...rest: unknown[]
    ) => {
      if (
        typeof first === "string" &&
        rest.length === 0 &&
        isStructuredLogPayload(second)
      ) {
        return originalMethod.call(baseLogger, { msg: first, ...second });
      }

      if (
        typeof first === "string" &&
        rest.length === 0 &&
        second instanceof Error
      ) {
        return originalMethod.call(baseLogger, { msg: first, err: second });
      }

      return originalMethod.call(baseLogger, first, second, ...rest);
    }) as StructuredLogMethod;
  };

  (
    ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const
  ).forEach(wrapMethod);

  wrappedLogger.child = (bindings: Bindings, options?: ChildLoggerOptions) =>
    wrapStructuredLogger(originalChild(bindings, options));

  return wrappedLogger;
}

// ---------------------------------------------------------------------------
// Logger instance
// ---------------------------------------------------------------------------
export const logger = wrapStructuredLogger(
  pino({
    level: IS_TEST ? "silent" : LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    base: { instanceId: INSTANCE_ID },
    timestamp: pino.stdTimeFunctions.isoTime,
    mixin() {
      const context = traceStore.getStore();
      return context
        ? { requestId: context.requestId, correlationId: context.correlationId }
        : {};
    },
    ...(IS_PRODUCTION
      ? {}
      : {
          transport: {
            target: "pino-pretty",
            options: {
              colorize: true,
              translateTime: "SYS:yyyy-mm-dd HH:MM:ss",
              ignore: "pid,hostname",
            },
          },
        }),
  }),
);

// ---------------------------------------------------------------------------
// Child-logger helper — attach requestId / correlationId to every log entry
// ---------------------------------------------------------------------------
export function withRequestId(requestId: string): pino.Logger {
  return logger.child({ requestId });
}

export function withCorrelationId(correlationId: string): pino.Logger {
  return logger.child({ correlationId });
}

// ---------------------------------------------------------------------------
// Sensitive-field redaction helper (kept for backward-compat)
// ---------------------------------------------------------------------------
export function redactSensitiveFields(obj: unknown, depth = 0): unknown {
  const SENSITIVE_KEYS = new Set([
    "password",
    "token",
    "secret",
    "secretKey",
    "authorization",
    "refreshToken",
    "apiKey",
    "privateKey",
  ]);

  if (depth > 10 || obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj))
    return obj.map((item) => redactSensitiveFields(item, depth + 1));

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    result[key] = SENSITIVE_KEYS.has(key)
      ? "[REDACTED]"
      : redactSensitiveFields(value, depth + 1);
  }
  return result;
}
