import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.utils';
import { getCorrelationId } from '../middleware/correlation-id.middleware';

export interface AppError extends Error {
  statusCode?: number;
  isOperational?: boolean;
}

export const errorHandler = (
  err: AppError,
  req: Request,
  res: Response,
  _next: NextFunction,
) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  // Log error
  logger.error(`${req.method} ${req.path}`, {
    correlationId: getCorrelationId() ?? req.correlationId,
    error: message,
    statusCode,
    stack: err.stack,
    ip: req.ip,
  });

  res.status(statusCode).json({
    status: 'error',
    message,
    timestamp: new Date().toISOString(),
    ...(process.env.NODE_ENV === 'development' && {
      stack: err.stack,
      path: req.path,
    }),
  });
};

export const createError = (
  message: string,
  statusCode: number = 500,
): AppError => {
  const error: AppError = new Error(message);
  error.statusCode = statusCode;
  error.isOperational = true;
  return error;
};
