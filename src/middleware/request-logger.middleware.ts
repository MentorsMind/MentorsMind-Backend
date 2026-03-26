import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

/**
 * Request / response logger middleware.
 *
 * Logs every incoming request and, on `res.finish`, the outgoing response
 * with status code and duration.  All log entries include the correlation ID
 * when present on the request object.
 *
 * Log level selection:
 *   5xx → error
 *   4xx → warn
 *   everything else → info
 */
export const requestLoggerMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const startTime = Date.now();
  const { method, originalUrl, ip } = req;
  const correlationId = req.correlationId;
  const userAgent = req.get('user-agent');

  logger.info('Incoming request', {
    correlationId,
    method,
    url: originalUrl,
    ip,
    userAgent,
  });

  res.on('finish', () => {
    const durationMs = Date.now() - startTime;
    const { statusCode } = res;

    const logMeta = {
      correlationId,
      method,
      url: originalUrl,
      statusCode,
      durationMs,
    };

    if (statusCode >= 500) {
      logger.error('Request completed with server error', logMeta);
    } else if (statusCode >= 400) {
      logger.warn('Request completed with client error', logMeta);
    } else {
      logger.info('Request completed', logMeta);
    }
  });

  next();
};
