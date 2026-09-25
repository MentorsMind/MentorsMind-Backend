import { Request, Response, NextFunction } from "express";
import * as Sentry from "@sentry/node";
import { logger } from "../utils/logger.utils";
import { traceStore } from "./tracing.middleware";
import { CircuitBreakerError } from "../services/database.service";
import { OracleUnavailableError } from "../services/oracle.service";
import {
  ErrorCode,
  ERROR_CATALOG,
  getCatalogEntry,
  ErrorCatalogEntry,
} from "../errors/error-codes";
import i18next, { detectLanguage } from "../config/i18n.config";

export interface AppError extends Error {
  code?: ErrorCode;
  statusCode?: number;
  isOperational?: boolean;
  details?: Record<string, unknown>;
}

/** JSON body shape returned for every API error. */
export interface ErrorResponse {
  status: "error";
  code: string;
  message: string;
  details?: Record<string, unknown>;
  requestId?: string;
  timestamp: string;
}

/**
 * PostgreSQL SQLSTATE-derived codes → ErrorCode mapping so database
 * failures surface as typed codes instead of raw strings.
 */
const DB_CODE_TO_ERROR_CODE: Record<string, ErrorCode> = {
  CONNECTION_FAILED: ErrorCode.DATABASE_CONNECTION_FAILED,
  QUERY_TIMEOUT: ErrorCode.DATABASE_QUERY_TIMEOUT,
  SERIALIZATION_FAILURE: ErrorCode.SERVICE_UNAVAILABLE,
  UNIQUE_VIOLATION: ErrorCode.DATABASE_UNIQUE_VIOLATION,
  FOREIGN_KEY_VIOLATION: ErrorCode.DATABASE_FOREIGN_KEY_VIOLATION,
  NOT_NULL_VIOLATION: ErrorCode.BAD_REQUEST,
  CHECK_VIOLATION: ErrorCode.BAD_REQUEST,
};

/**
 * Resolves the ErrorCode carried by a thrown error.
 * Falls back through: explicit AppError code → CircuitBreaker → DB error
 * mapping → statusCode heuristic → INTERNAL_SERVER_ERROR.
 */
function resolveErrorCode(err: AppError | CircuitBreakerError, statusCode: number): ErrorCode {
  const explicit = (err as AppError).code;
  if (explicit && explicit in ERROR_CATALOG) return explicit;

  if (err instanceof CircuitBreakerError) return ErrorCode.CIRCUIT_BREAKER_OPEN;

  const dbCode = (err as any).code as string | undefined;
  if (!explicit && dbCode && DB_CODE_TO_ERROR_CODE[dbCode]) {
    return DB_CODE_TO_ERROR_CODE[dbCode];
  }

  switch (statusCode) {
    case 400:
      return ErrorCode.BAD_REQUEST;
    case 401:
      return ErrorCode.AUTH_UNAUTHORIZED;
    case 402:
      return ErrorCode.PAYMENT_REQUIRED;
    case 403:
      return ErrorCode.AUTHZ_FORBIDDEN;
    case 404:
      return ErrorCode.NOT_FOUND;
    case 409:
      return ErrorCode.CONFLICT;
    case 413:
      return ErrorCode.UPLOAD_FILE_TOO_LARGE;
    case 422:
      return ErrorCode.VALIDATION_ERROR;
    case 429:
      return ErrorCode.RATE_LIMIT_EXCEEDED;
    case 503:
      return ErrorCode.SERVICE_UNAVAILABLE;
    default:
      return ErrorCode.INTERNAL_SERVER_ERROR;
  }
}

/**
 * Localizes an error message using i18next based on the request's
 * Accept-Language header. Falls back to the catalog's English default when
 * i18next is not initialized or the key is missing in the target locale.
 *
 * Interpolation placeholders ({{field}}, {{column}}, …) are filled from
 * the error's `details` record.
 */
function resolveLocalizedMessage(
  entry: ErrorCatalogEntry,
  req: Request,
  details?: Record<string, unknown>,
): string {
  try {
    if (i18next.isInitialized) {
      const language = detectLanguage(req.headers["accept-language"]);
      const localized = i18next.t(entry.i18nKey, {
        ns: "errors",
        lng: language,
        ...details,
        defaultValue: "",
      });
      if (typeof localized === "string" && localized.length > 0) {
        return localized;
      }
    }
  } catch {
    // i18n unavailable — fall through to the English catalog default.
  }
  return entry.message;
}

export const errorHandler = (
  err: AppError | CircuitBreakerError,
  req: Request,
  res: Response,
  _next: NextFunction,
) => {
  if (err instanceof OracleUnavailableError) {
    res.setHeader("Retry-After", "60");
    res.status(503).json({
      status: "error",
      code: ErrorCode.ORACLE_UNAVAILABLE,
      message: err.message,
      details: {
        contractError: err.contractError,
        usedFallback: err.usedFallback,
      },
      requestId:
        traceStore.getStore()?.requestId ||
        (req as any).requestId ||
        res.locals?.requestId,
      timestamp: new Date().toISOString(),
    } satisfies ErrorResponse & { details: Record<string, unknown> });
    return;
  }

  if (err instanceof CircuitBreakerError) {
    const retryAfter = (err as CircuitBreakerError).retryAfterSeconds;
    res.setHeader("Retry-After", String(retryAfter));
    res.status(503).json({
      status: "error",
      code: ErrorCode.CIRCUIT_BREAKER_OPEN,
      message: err.message,
      retryAfter,
      requestId:
        traceStore.getStore()?.requestId ||
        (req as any).requestId ||
        res.locals?.requestId,
      timestamp: new Date().toISOString(),
    } satisfies ErrorResponse & { retryAfter: number });
    return;
  }

  const statusCode = (err as AppError).statusCode || 500;

  const context = traceStore.getStore();
  const requestId =
    context?.requestId || (req as any).requestId || res.locals?.requestId;
  const correlationId = context?.correlationId || (req as any).correlationId;

  const user = (req as any).user;

  logger.error(`${req.method} ${req.path}`, {
    correlationId,
    requestId,
    errorCode: resolveErrorCode(err, statusCode),
    error: err.message,
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
  res.setHeader("X-Request-ID", (req.headers["x-request-id"] as string) || "");
  res.setHeader("X-Trace-ID", (req.headers["x-trace-id"] as string) || "");

  const catalogEntry = getCatalogEntry(resolveErrorCode(err, statusCode));
  const details = "details" in err ? (err as AppError).details : undefined;

  const body: ErrorResponse = {
    status: "error",
    code: catalogEntry.code,
    message: resolveLocalizedMessage(catalogEntry, req, details),
    ...(details !== undefined && { details }),
    requestId,
    timestamp: new Date().toISOString(),
    ...(process.env.NODE_ENV === "development" && {
      stack: err.stack,
      path: req.path,
    }),
  };

  res.status(statusCode).json(body);
};

/**
 * Creates a typed operational error carrying a machine-readable ErrorCode.
 * The human-readable message is derived from the error catalog (and
 * localized at the middleware layer via Accept-Language), so callers never
 * pass free-form strings anymore.
 *
 * @param code       ErrorCode from the central catalog
 * @param httpStatus HTTP status to respond with (defaults to catalog value)
 * @param details    Optional structured payload — also used for i18n
 *                   interpolation of placeholders like {{field}}
 */
export const createError = (
  code: ErrorCode,
  httpStatus?: number,
  details?: Record<string, unknown>,
): AppError => {
  const catalogEntry =
    ERROR_CATALOG[code] ?? getCatalogEntry(ErrorCode.INTERNAL_SERVER_ERROR);
  const error: AppError = new Error(catalogEntry.message);
  error.code = code;
  error.statusCode = httpStatus ?? catalogEntry.httpStatus;
  error.isOperational = true;
  error.details = details;
  return error;
};
