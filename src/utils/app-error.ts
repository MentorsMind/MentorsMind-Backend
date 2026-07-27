/**
 * Application Error Class
 * 
 * Extends Error with structured error codes and metadata for consistent
 * error handling throughout the application.
 */

import { ErrorCode, ERROR_METADATA, ErrorCategory, AppErrorData } from '../types/errors.types';

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly category: ErrorCategory;
  public readonly context?: Record<string, any>;
  public readonly cause?: Error;
  public readonly isOperational: boolean = true;
  public readonly retryable?: boolean;
  public readonly retryAfter?: number;

  constructor(data: AppErrorData) {
    // Ensure message is provided
    const message = data.message || ERROR_METADATA[data.code].description;
    super(message);

    // Set the prototype explicitly for instanceof checks
    Object.setPrototypeOf(this, AppError.prototype);

    this.name = 'AppError';
    this.code = data.code;
    this.context = data.context;
    this.cause = data.cause;
    this.retryable = data.retryable;
    this.retryAfter = data.retryAfter;

    // Get metadata for this error code
    const metadata = ERROR_METADATA[data.code];
    this.statusCode = data.statusCode || metadata.statusCode;
    this.category = metadata.category;

    // Maintain proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Factory method: Create validation error
   */
  static validation(message: string, context?: Record<string, any>): AppError {
    return new AppError({
      code: ErrorCode.INVALID_INPUT,
      message,
      context,
    });
  }

  /**
   * Factory method: Create not found error
   */
  static notFound(resource: string, context?: Record<string, any>): AppError {
    return new AppError({
      code: ErrorCode.RESOURCE_NOT_FOUND,
      message: `${resource} not found`,
      context,
    });
  }

  /**
   * Factory method: Create conflict error
   */
  static conflict(message: string, context?: Record<string, any>): AppError {
    return new AppError({
      code: ErrorCode.RESOURCE_ALREADY_EXISTS,
      message,
      context,
    });
  }

  /**
   * Factory method: Create unauthorized error
   */
  static unauthorized(message: string = 'Authentication required', context?: Record<string, any>): AppError {
    return new AppError({
      code: ErrorCode.UNAUTHORIZED,
      message,
      context,
    });
  }

  /**
   * Factory method: Create forbidden error
   */
  static forbidden(message: string = 'Access denied', context?: Record<string, any>): AppError {
    return new AppError({
      code: ErrorCode.ACCESS_DENIED,
      message,
      context,
    });
  }

  /**
   * Factory method: Create internal server error
   */
  static internal(message: string = 'Internal server error', cause?: Error, context?: Record<string, any>): AppError {
    return new AppError({
      code: ErrorCode.INTERNAL_SERVER_ERROR,
      message,
      cause,
      context,
    });
  }

  /**
   * Factory method: Create conflict for specific resource type
   */
  static bookingConflict(reason: string, context?: Record<string, any>): AppError {
    return new AppError({
      code: ErrorCode.BOOKING_CONFLICT,
      message: reason,
      context,
    });
  }

  /**
   * Factory method: Create booking already paid error
   */
  static bookingAlreadyPaid(context?: Record<string, any>): AppError {
    return new AppError({
      code: ErrorCode.BOOKING_ALREADY_PAID,
      message: 'Booking has already been paid',
      context,
    });
  }

  /**
   * Factory method: Create insufficient funds error
   */
  static insufficientFunds(message: string = 'Insufficient funds', context?: Record<string, any>): AppError {
    return new AppError({
      code: ErrorCode.INSUFFICIENT_FUNDS,
      message,
      context,
    });
  }

  /**
   * Factory method: Create rate limit error with retry info
   */
  static rateLimitExceeded(retryAfter: number, context?: Record<string, any>): AppError {
    return new AppError({
      code: ErrorCode.RATE_LIMIT_EXCEEDED,
      message: `Rate limit exceeded. Please retry after ${retryAfter} seconds.`,
      retryable: true,
      retryAfter,
      context,
    });
  }

  /**
   * Convert to error response for API
   */
  toResponse(requestId: string): {
    status: 'error';
    code: string;
    message: string;
    category: string;
    requestId: string;
    timestamp: string;
    details?: {
      context?: Record<string, any>;
      retryable?: boolean;
      retryAfter?: number;
    };
  } {
    return {
      status: 'error',
      code: this.code,
      message: this.message,
      category: this.category,
      requestId,
      timestamp: new Date().toISOString(),
      ...(this.context || this.retryable || this.retryAfter) && {
        details: {
          ...(this.context && { context: this.context }),
          ...(this.retryable && { retryable: this.retryable }),
          ...(this.retryAfter && { retryAfter: this.retryAfter }),
        },
      },
    };
  }
}

/**
 * Type guard to check if an error is an AppError
 */
export function isAppError(error: any): error is AppError {
  return error instanceof AppError;
}

/**
 * Safe error serialization (prevents circular references, sensitive data)
 */
export function serializeError(error: unknown): {
  message: string;
  code?: string;
  category?: string;
  stack?: string;
} {
  if (isAppError(error)) {
    return {
      message: error.message,
      code: error.code,
      category: error.category,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    };
  }

  return {
    message: String(error),
  };
}
