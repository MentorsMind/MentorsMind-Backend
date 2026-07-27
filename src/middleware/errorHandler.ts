import { Request, Response, NextFunction } from "express";
import * as Sentry from "@sentry/node";
import { logger } from "../utils/logger.utils";
import { traceStore } from "./tracing.middleware";
import { CircuitBreakerError } from "../services/database.service";
import { AppError, isAppError } from "../utils/app-error";
import { ErrorCode, ERROR_METADATA } from "../types/errors.types";

/**
 * Global error handler middleware
 * 
 * Converts all errors into structured responses with machine-readable error codes.
 * Automatically generates HTTP status codes from error metadata.
 */
export const errorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) => {
  // Ensure request ID exists
  const context = traceStore.getStore();
  const requestId =
    context?.requestId || (req as any).requestId || res.locals?.requestId || 'unknown';
  const correlationId = context?.correlationId || (req as any).correlationId;

  const user = (req as any).user;

  // Handle circuit breaker errors specially
  if (err instanceof CircuitBreakerError) {
    const retryAfter = (err as CircuitBreakerError).retryAfterSeconds;
    res.setHeader("Retry-After", String(retryAfter));
    
    logger.error(`${req.method} ${req.path} - Circuit breaker open`, {
      correlationId,
      requestId,
      error: err.message,
      statusCode: 503,
      ip: req.ip,
    });

    res.setHeader("X-Request-ID", requestId);
    res.setHeader("X-Trace-ID", correlationId || "");
    
    res.status(503).json({
      status: "error",
      code: ErrorCode.SERVICE_UNAVAILABLE,
      message: "Service temporarily unavailable",
      category: "SERVICE_UNAVAILABLE",
      requestId,
      timestamp: new Date().toISOString(),
      details: {
        retryable: true,
        retryAfter,
      },
    });
    return;
  }

  // Convert to AppError if needed
  let appError: AppError;
  if (isAppError(err)) {
    appError = err;
  } else if (err instanceof Error) {
    // Convert unknown errors to internal server errors
    appError = AppError.internal(err.message, err);
  } else {
    // Handle non-Error objects
    appError = AppError.internal(String(err));
  }

  const statusCode = appError.statusCode;

  // Log the error
  logger.error(`${req.method} ${req.path}`, {
    correlationId,
    requestId,
    code: appError.code,
    category: appError.category,
    message: appError.message,
    statusCode,
    context: appError.context,
    stack: appError.stack,
    ip: req.ip,
  });

  // Report 5xx errors to Sentry
  if (statusCode >= 500) {
    Sentry.withScope((scope) => {
      if (user) {
        scope.setUser({ id: user.userId, role: user.role });
      }
      scope.setContext("error", {
        code: appError.code,
        category: appError.category,
        context: appError.context,
      });
      scope.setContext("request", {
        requestId,
        correlationId,
        method: req.method,
        path: req.path,
        statusCode,
      });
      Sentry.captureException(appError);
    });
  }

  // Set standard headers
  res.setHeader("X-Request-ID", requestId);
  res.setHeader("X-Trace-ID", correlationId || "");

  // Add retry header for retryable errors
  if (appError.retryAfter) {
    res.setHeader("Retry-After", String(appError.retryAfter));
  }

  // Build response
  const response = appError.toResponse(requestId);

  // Include stack trace in development
  if (process.env.NODE_ENV === "development") {
    (response as any).stack = appError.stack;
    (response as any).path = req.path;
  }

  res.status(statusCode).json(response);
};

/**
 * Utility function: Create an error with specific code
 * @deprecated Use AppError class directly instead
 * 
 * @example
 * throw createError("Booking not found", ErrorCode.BOOKING_NOT_FOUND);
 */
export const createError = (
  message: string,
  errorCode: ErrorCode = ErrorCode.INTERNAL_SERVER_ERROR,
  context?: Record<string, any>,
): AppError => {
  return new AppError({
    code: errorCode,
    message,
    context,
  });
};

/**
 * Legacy compatibility: Create error by status code
 * @deprecated Use AppError class directly instead
 * 
 * Maps status code to appropriate error code.
 */
export const createErrorByStatus = (
  message: string,
  statusCode: number = 500,
  context?: Record<string, any>,
): AppError => {
  // Find appropriate error code based on status
  let errorCode = ErrorCode.INTERNAL_SERVER_ERROR;
  
  switch (statusCode) {
    case 400:
      errorCode = ErrorCode.INVALID_INPUT;
      break;
    case 401:
      errorCode = ErrorCode.UNAUTHORIZED;
      break;
    case 403:
      errorCode = ErrorCode.ACCESS_DENIED;
      break;
    case 404:
      errorCode = ErrorCode.RESOURCE_NOT_FOUND;
      break;
    case 409:
      errorCode = ErrorCode.RESOURCE_ALREADY_EXISTS;
      break;
    case 429:
      errorCode = ErrorCode.RATE_LIMIT_EXCEEDED;
      break;
    case 503:
      errorCode = ErrorCode.SERVICE_UNAVAILABLE;
      break;
  }

  return new AppError({
    code: errorCode,
    message,
    context,
  });
};
