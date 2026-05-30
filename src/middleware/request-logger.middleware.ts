import pinoHttp from "pino-http";
import type { Response } from "express";
import { logger } from "../utils/logger";
import { maskPII } from "../utils/pii-mask";

/**
 * pino-http request logger middleware.
 *
 * Every log line includes: timestamp, level, requestId, userId (if set on
 * res.locals by auth middleware), method, path, statusCode, responseTime.
 *
 * Log levels:
 *   5xx → error
 *   4xx → warn
 *   2xx/3xx → info
 */
export const requestLoggerMiddleware = pinoHttp({
  logger,
  // Attach requestId and userId to every log line. Try res.locals then fall back to req.
  genReqId: (req, res) =>
    (res as unknown as Response).locals?.requestId || (req as any).requestId,
  customProps: (req, res) => ({
    requestId:
      (res as unknown as Response).locals?.requestId || (req as any).requestId,
    correlationId:
      (res as unknown as Response).locals?.correlationId || (req as any).correlationId,
    userId: (res as unknown as Response).locals?.userId ?? undefined,
    responseTimeMs: (res as unknown as Response).locals?.responseTimeMs,
  }),
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  serializers: {
    req: (req) => ({
      method: req.method,
      path: maskPII(req.url ?? ""),
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
  },
  // Never log sensitive headers
  redact: ["req.headers.authorization", "req.headers.cookie"],
});
