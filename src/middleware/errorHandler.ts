import { Request, Response, NextFunction } from "express";
import * as Sentry from "@sentry/node";
import { logger } from "../utils/logger.utils";
import { traceStore } from "./tracing.middleware";
import { CircuitBreakerError } from "../services/database.service";
import { AppError, ValidationError } from "../types/error.types";
import { ERROR_CODE_MESSAGES } from "../constants/error-codes";

/**
 * Enhanced error handler that returns structured error responses with machine-readable codes
 * @see docs/ERROR_HANDLING.md for error handling patterns
 */
export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction,
) => {
  // Handle circuit breaker errors
  if (err instanceof CircuitBreakerError) {
    const retryAfter = (err as CircuitBreakerError).retryAfterSeconds;
    res.setHeader("Retry-After", String(retryAfter));
    res.status(503).json({
      status: "error",
      code: "SERVICE_CIRCUIT_BREAKER_OPEN",
      message: ERROR_CODE_MESSAGES["SERVICE_CIRCUIT_BREAKER_OPEN" as any],
      retryAfter,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // Extract context
  const context = traceStore.getStore();
  const requestId =
    context?.requestId || (req as any).requestId || res.locals?.requestId;
  const correlationId = context?.correlationId || (req as any).correlationId;
  const user = (req as any).user;

  let statusCode = 500;
  let code = "SERVER_INTERNAL_ERROR";
  let message = "Internal Server Error";
  let details: Record<string, any> | undefined;

  // Handle AppError instances (structured errors)
  if (err instanceof AppError) {
    statusCode = err.statusCode;
    code = err.code;
    message = err.message || ERROR_CODE_MESSAGES[err.code];
    details = err.details;

    // Log operational errors at appropriate level
    logger.warn(`${req.method} ${req.path}`, {
      correlationId,
      requestId,
      code,
      statusCode,
      message,
      ip: req.ip,
    });
  }
  // Handle validation errors separately
  else if (err instanceof ValidationError) {
    statusCode = err.statusCode;
    code = err.code;
    message = err.message;
    details = {
      fieldErrors: err.fieldErrors,
    };

    logger.warn(`${req.method} ${req.path}`, {
      correlationId,
      requestId,
      code,
      statusCode,
      fieldErrors: err.fieldErrors,
      ip: req.ip,
    });
  }
  // Handle unexpected errors
  else {
    statusCode = err?.statusCode || 500;
    message = err?.message || "Internal Server Error";
    code = "SERVER_INTERNAL_ERROR";

    logger.error(`${req.method} ${req.path}`, {
      correlationId,
      requestId,
      error: message,
      statusCode,
      stack: err?.stack,
      ip: req.ip,
    });

    // Report unexpected errors to Sentry
    Sentry.withScope((scope) => {
      if (user) {
        scope.setUser({ id: user.userId, role: user.role });
      }
      scope.setContext("request", {
        requestId,
        correlationId,
        method: req.method,
        path: req.path,
        statusCode,
      });
      Sentry.captureException(err);
    });
  }

  // Report 5xx errors to Sentry
  if (statusCode >= 500 && err instanceof AppError) {
    Sentry.withScope((scope) => {
      if (user) {
        scope.setUser({ id: user.userId, role: user.role });
      }
      scope.setContext("request", {
        requestId,
        correlationId,
        method: req.method,
        path: req.path,
        statusCode,
        code,
      });
      Sentry.captureException(err);
    });
  }

  // Set trace headers
  res.setHeader("X-Request-ID", (req.headers["x-request-id"] as string) || "");
  res.setHeader("X-Trace-ID", (req.headers["x-trace-id"] as string) || "");

  // Build response body
  const responseBody: Record<string, any> = {
    status: "error",
    code,
    message,
    requestId,
    timestamp: new Date().toISOString(),
  };

  // Include details if available
  if (details) {
    responseBody.details = details;
  }

  // Include stack trace in development
  if (process.env.NODE_ENV === "development" && err?.stack) {
    responseBody.stack = err.stack;
    responseBody.path = req.path;
  }

  res.status(statusCode).json(responseBody);
};

/**
 * @deprecated Use AppError and subclasses instead
 * Helper to create traditional errors (for backward compatibility)
 */
export const createError = (
  message: string,
  statusCode: number = 500,
): Error => {
  const error = new Error(message);
  (error as any).statusCode = statusCode;
  (error as any).isOperational = true;
  return error;
};
