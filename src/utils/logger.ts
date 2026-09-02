import * as pino from "pino";
import type { Bindings, ChildLoggerOptions } from "pino";
import * as os from "os";
import { env } from "../config/env";
import { maskPIIDeep } from "./pii-mask";

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
import { trace } from "@opentelemetry/api";

/**
 * Simple Logger Utility
 * Provides consistent logging across services
 */

export class Logger {
  private context: string;

  constructor(context: string = "App") {
    this.context = context;
  }

  public info(message: string | object, ...args: any[]): void {
    console.log(`[INFO] [${this.context}]`, message, ...args);
  }

  public debug(message: string | object, ...args: any[]): void {
    console.log(`[DEBUG] [${this.context}]`, message, ...args);
  }

  public warn(message: string | object, ...args: any[]): void {
    console.warn(`[WARN] [${this.context}]`, message, ...args);
  }

  public error(message: string | object, ...args: any[]): void {
    console.error(`[ERROR] [${this.context}]`, message, ...args);
  }
}

export const logger = new Logger("App");
export default logger;
