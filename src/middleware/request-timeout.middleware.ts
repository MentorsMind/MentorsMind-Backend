/**
 * Request Timeout Middleware (issue #1114)
 *
 * Prevents hung requests from holding sockets indefinitely. Any request that
 * does not complete within `timeoutMs` is answered with `408 Request Timeout`
 * and the underlying connection is destroyed so downstream work can no longer
 * keep the socket/worker occupied.
 *
 * The timeout is configurable globally via `REQUEST_TIMEOUT_MS` in the
 * environment (default: 30000 ms) and per-instance via the `timeoutMs` option.
 */

import type { NextFunction, Request, Response } from "express";
import { Logger } from "../utils/logger.utils";

export interface RequestTimeoutOptions {
  /** Budget in milliseconds before a request is considered hung. */
  timeoutMs?: number;
  /** HTTP status sent on timeout. Defaults to 408 Request Timeout. */
  statusCode?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_STATUS_CODE = 408;

function parseTimeoutEnv(): number {
  const raw = process.env.REQUEST_TIMEOUT_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

export function requestTimeoutMiddleware(
  options: RequestTimeoutOptions = {},
) {
  const timeoutMs = options.timeoutMs ?? parseTimeoutEnv();
  const statusCode = options.statusCode ?? DEFAULT_STATUS_CODE;

  return (req: Request, res: Response, next: NextFunction): void => {
    const timer = setTimeout(() => {
      logger.warn("Request timed out — destroying hung connection", {
        method: req.method,
        path: (req as { route?: { path?: string } }).route?.path ?? req.path,
        timeoutMs,
      });

      if (!res.writableEnded) {
        res.status(statusCode).json({
          success: false,
          error: "Request timed out",
        });
      }
      // Force-close the connection so the hung handler cannot keep it open.
      res.destroy();
    }, timeoutMs);
    // Do not let the timer alone keep the process alive.
    timer.unref?.();

    res.on("close", () => clearTimeout(timer));
    next();
  };
}

export default requestTimeoutMiddleware;