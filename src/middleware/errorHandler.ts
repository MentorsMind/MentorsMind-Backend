import { Request, Response, NextFunction } from "express";
import * as Sentry from "@sentry/node";
import { logger } from "../utils/logger.utils";
import { traceStore } from "./tracing.middleware";

export interface AppError extends Error {
  statusCode?: number;
  isOperational?: boolean;
}

export const errorHandler = (
  err: AppError,
  _req: Request,
  res: Response,
  _next: NextFunction,
) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || "Internal Server Error";

  const context = traceStore.getStore();
  const requestId =
    context?.requestId || (req as any).requestId || res.locals?.requestId;
  const correlationId = context?.correlationId || (req as any).correlationId;

  const user = (req as any).user;

  logger.error(`${req.method} ${req.path}`, {
    correlationId,
    requestId,
    error: message,
    statusCode,
    stack: err.stack,
    ip: req.ip,
  });

  // Only report 5xx errors to Sentry
  if (statusCode >= 500) {
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

  res.status(statusCode).json({
    status: "error",
    message,
    requestId,
    timestamp: new Date().toISOString(),
    ...(process.env.NODE_ENV === "development" && {
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
