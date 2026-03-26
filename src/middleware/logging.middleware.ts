/**
 * logging.middleware.ts
 *
 * Thin compatibility shim. Request/response logging is now handled by
 * `request-logger.middleware.ts` (Winston-based). This file re-exports
 * helpers for any consumers that still import from here.
 */
import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

/**
 * @deprecated Use `requestLoggerMiddleware` from `request-logger.middleware.ts`.
 * Kept for backward compatibility.
 */
export const requestLogger = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const start = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const logMeta = {
      correlationId: (req as any).correlationId,
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      durationMs,
      ip: req.ip,
    };

    if (res.statusCode >= 500) {
      logger.error('Request completed with server error', logMeta);
    } else if (res.statusCode >= 400) {
      logger.warn('Request completed with client error', logMeta);
    } else {
      logger.info('Request completed', logMeta);
    }
  });

  next();
};

/**
 * @deprecated Use `requestLoggerMiddleware` from `request-logger.middleware.ts`.
 * Kept for backward compatibility — delegates to the same Winston logger.
 */
export const customLogger = requestLogger;

