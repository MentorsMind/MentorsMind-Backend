import { Request, Response, NextFunction } from 'express';
import pool from '../config/database';
import config from '../config';
import { Logger } from "../utils/logger.utils";

/**
 * Middleware to monitor database pool utilization and apply a circuit breaker
 * if the database connection pool is overwhelmed with waiting requests.
 */
export const dbHealthMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const { totalCount, idleCount, waitingCount } = pool;

  // Log a warning if the database is experiencing queueing
  if (waitingCount > 0) {
    logger.warn(
      { totalCount, idleCount, waitingCount },
      'Database connection pool is experiencing high load (requests waiting for connection)'
    );
  }

  // Circuit Breaker: Reject requests early if the database is overloaded
  if (
    config.db.circuitBreakerEnabled &&
    waitingCount >= config.db.poolExhaustionThreshold
  ) {
    logger.error(
      { totalCount, idleCount, waitingCount, threshold: config.db.poolExhaustionThreshold },
      'Database connection pool exhausted. Circuit breaker triggered.'
    );
    
    res.status(503).json({
      status: 'error',
      message: 'Service Unavailable: The database is currently experiencing high load. Please try again later.'
    });
    return;
  }

  next();
};
