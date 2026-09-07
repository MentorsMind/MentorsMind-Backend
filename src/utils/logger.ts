import { env } from "../config/env";
import { maskPIIDeep } from "./pii-mask";

// ---------------------------------------------------------------------------
// Minimal pino-compatible type so we don't need pino installed at type-check
// time. The actual pino instance is created at runtime via require().
// ---------------------------------------------------------------------------
interface PinoLogger {
  level: string;
  info(obj: object | string, msg?: string, ...args: unknown[]): void;
  debug(obj: object | string, msg?: string, ...args: unknown[]): void;
  warn(obj: object | string, msg?: string, ...args: unknown[]): void;
  error(obj: object | string, msg?: string, ...args: unknown[]): void;
  fatal(obj: object | string, msg?: string, ...args: unknown[]): void;
  trace(obj: object | string, msg?: string, ...args: unknown[]): void;
  child(bindings: Record<string, unknown>): PinoLogger;
}

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
const LOG_LEVEL: string =
  ((env as Record<string, unknown>).LOG_LEVEL as string) ??
  (IS_TEST ? "silent" : IS_PRODUCTION ? "info" : "debug");

function createPinoLogger(): PinoLogger {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = (globalThis as any).require?.("pino") ??
    // fallback: when bundled with ts-node, module is available via eval
    Function("m", "return require(m)")("pino"); // eslint-disable-line no-new-func
  const factory = typeof mod === "function" ? mod : mod?.default ?? mod;
  return factory({
    level: LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    ...(IS_PRODUCTION
      ? {}
      : {
          transport: {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "HH:MM:ss" },
          },
        }),
  });
}

export const logger: PinoLogger = createPinoLogger();
export default logger;

/**
 * Context-bound logger. Binds a `context` field to every log line.
 * Use `new Logger("MyService")` in service classes.
 * Prefer the module-level `logger` singleton for most use cases.
 */
export class Logger {
  private child: PinoLogger;

  constructor(context: string = "App") {
    this.child = logger.child({ context });
  }

  info(obj: object | string, msg?: string): void {
    if (typeof obj === "string") {
      this.child.info(obj);
    } else {
      this.child.info(maskPIIDeep(obj) as object, msg ?? "");
    }
  }

  debug(obj: object | string, msg?: string): void {
    if (typeof obj === "string") {
      this.child.debug(obj);
    } else {
      this.child.debug(maskPIIDeep(obj) as object, msg ?? "");
    }
  }

  warn(obj: object | string, msg?: string): void {
    if (typeof obj === "string") {
      this.child.warn(obj);
    } else {
      this.child.warn(maskPIIDeep(obj) as object, msg ?? "");
    }
  }

  error(obj: object | string, msg?: string): void {
    if (typeof obj === "string") {
      this.child.error(obj);
    } else {
      this.child.error(maskPIIDeep(obj) as object, msg ?? "");
    }
  }
}
