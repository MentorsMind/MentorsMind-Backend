import { ErrorCode, ERROR_CODE_TO_STATUS } from "../constants/error-codes";

/**
 * Extended error class with machine-readable error codes
 * Provides both human-readable messages and machine-readable codes for API consumers
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly details?: Record<string, any>;
  public readonly timestamp: string;

  constructor(
    code: ErrorCode,
    message?: string,
    details?: Record<string, any>,
  ) {
    super(message);
    this.code = code;
    this.statusCode = ERROR_CODE_TO_STATUS[code];
    this.isOperational = true;
    this.details = details;
    this.timestamp = new Date().toISOString();

    // Maintains proper stack trace
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Validation error with field-level details
 */
export class ValidationError extends AppError {
  public readonly fieldErrors: Record<string, string[]>;

  constructor(
    fieldErrors: Record<string, string[]>,
    message: string = "Validation failed",
  ) {
    super("VALIDATION_INVALID_INPUT" as ErrorCode, message, { fieldErrors });
    this.fieldErrors = fieldErrors;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Authentication/Authorization errors
 */
export class AuthenticationError extends AppError {
  constructor(code: ErrorCode, message?: string, details?: Record<string, any>) {
    super(code, message, details);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Not found errors
 */
export class NotFoundError extends AppError {
  constructor(
    resourceType: string,
    resourceId?: string,
    code?: ErrorCode,
  ) {
    const defaultCode: ErrorCode = "NOT_FOUND_USER" as ErrorCode;
    super(
      code || defaultCode,
      `${resourceType}${resourceId ? ` (${resourceId})` : ""} not found`,
      { resourceType, resourceId },
    );
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Conflict errors (409)
 */
export class ConflictError extends AppError {
  constructor(
    code: ErrorCode,
    message: string,
    details?: Record<string, any>,
  ) {
    super(code, message, details);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Business logic constraint violation
 */
export class BusinessLogicError extends AppError {
  constructor(
    code: ErrorCode,
    message: string,
    details?: Record<string, any>,
  ) {
    super(code, message, details);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * External service/integration errors
 */
export class ExternalServiceError extends AppError {
  public readonly service: string;
  public readonly originalError?: Error;

  constructor(
    service: string,
    code: ErrorCode,
    message: string,
    originalError?: Error,
    details?: Record<string, any>,
  ) {
    super(code, message, { service, ...details });
    this.service = service;
    this.originalError = originalError;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
