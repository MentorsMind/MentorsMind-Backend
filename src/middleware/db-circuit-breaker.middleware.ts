import { Request, Response, NextFunction } from 'express';
import { DatabaseError } from 'pg';
import { getCircuitState, CircuitBreakerError, onPoolPressure } from '../services/database.service';
import config from '../config';

/**
 * Type guard for pg.DatabaseError
 */
export function isDatabaseError(err: unknown): err is DatabaseError {
  return err instanceof DatabaseError;
}

/**
 * Checks if a DatabaseError code indicates connection or pool failure that should trigger circuit breaker tracking.
 */
export function handleDbErrorCode(err: unknown): string | undefined {
  if (isDatabaseError(err)) {
    const code = err.code;
    if (code && ['57P01', '57014', '08000', '08003', '08006'].includes(code)) {
      onPoolPressure();
    }
    return code;
  }
  return undefined;
}

export function dbCircuitBreakerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!config.db.circuitBreakerEnabled) {
    return next();
  }

  const state = getCircuitState();

  if (state === 'OPEN') {
    // We'll throw and catch in error handler, but let's also pre-check here for faster response
    const error = new CircuitBreakerError('Database circuit breaker is open', 5);
    res.setHeader('Retry-After', '5');
    res.status(503).json({
      error: 'Service temporarily unavailable',
      message: error.message,
      retryAfter: 5,
    });
    return;
  }

  next();
}
