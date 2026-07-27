/**
 * Structured Error Response Types
 * 
 * Provides machine-readable error codes and metadata for API consumers
 * to handle errors programmatically without string parsing.
 */

/**
 * Standard HTTP error codes mapped to application error categories.
 * Guides HTTP status code selection and error categorization.
 */
export enum ErrorCategory {
  // 4xx Client Errors
  VALIDATION = 'VALIDATION',           // 400: Input validation failed
  UNAUTHORIZED = 'UNAUTHORIZED',       // 401: Authentication required
  FORBIDDEN = 'FORBIDDEN',             // 403: Authorization failed
  NOT_FOUND = 'NOT_FOUND',             // 404: Resource not found
  CONFLICT = 'CONFLICT',               // 409: Resource conflict (state, duplicate)
  UNPROCESSABLE = 'UNPROCESSABLE',     // 422: Semantic error
  RATE_LIMIT = 'RATE_LIMIT',           // 429: Rate limited
  
  // 5xx Server Errors
  INTERNAL = 'INTERNAL',               // 500: Internal server error
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE', // 503: Temporary unavailability
}

/**
 * Machine-readable error codes with semantic meaning.
 * Each code uniquely identifies an error condition for programmatic handling.
 * 
 * Naming convention: DOMAIN_SPECIFIC_CONDITION
 * - DOMAIN: The feature or domain (BOOKING, AUTH, PAYMENT, etc.)
 * - CONDITION: What went wrong (NOT_FOUND, CONFLICT, INVALID, etc.)
 */
export enum ErrorCode {
  // Validation Errors (400)
  INVALID_INPUT = 'INVALID_INPUT',
  INVALID_EMAIL = 'INVALID_EMAIL',
  INVALID_PHONE = 'INVALID_PHONE',
  INVALID_CURRENCY = 'INVALID_CURRENCY',
  INVALID_TIMEZONE = 'INVALID_TIMEZONE',
  INVALID_DURATION = 'INVALID_DURATION',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',

  // Authentication Errors (401)
  UNAUTHORIZED = 'UNAUTHORIZED',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  INVALID_TOKEN = 'INVALID_TOKEN',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  TOKEN_REVOKED = 'TOKEN_REVOKED',
  MFA_REQUIRED = 'MFA_REQUIRED',

  // Authorization Errors (403)
  ACCESS_DENIED = 'ACCESS_DENIED',
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',
  ACCOUNT_SUSPENDED = 'ACCOUNT_SUSPENDED',
  ACCOUNT_BANNED = 'ACCOUNT_BANNED',
  MENTOR_UNAVAILABLE = 'MENTOR_UNAVAILABLE',

  // Not Found Errors (404)
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  MENTOR_NOT_FOUND = 'MENTOR_NOT_FOUND',
  MENTEE_NOT_FOUND = 'MENTEE_NOT_FOUND',
  BOOKING_NOT_FOUND = 'BOOKING_NOT_FOUND',
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  PAYMENT_NOT_FOUND = 'PAYMENT_NOT_FOUND',
  WALLET_NOT_FOUND = 'WALLET_NOT_FOUND',
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',

  // Conflict Errors (409)
  BOOKING_CONFLICT = 'BOOKING_CONFLICT',
  DUPLICATE_BOOKING = 'DUPLICATE_BOOKING',
  BOOKING_ALREADY_PAID = 'BOOKING_ALREADY_PAID',
  RESOURCE_ALREADY_EXISTS = 'RESOURCE_ALREADY_EXISTS',
  MENTOR_TIME_SLOT_TAKEN = 'MENTOR_TIME_SLOT_TAKEN',
  CONCURRENT_MODIFICATION = 'CONCURRENT_MODIFICATION',

  // Semantic/Unprocessable Errors (422)
  INSUFFICIENT_FUNDS = 'INSUFFICIENT_FUNDS',
  INVALID_STATE_TRANSITION = 'INVALID_STATE_TRANSITION',
  PREREQUISITE_NOT_MET = 'PREREQUISITE_NOT_MET',
  INVALID_BOOKING_STATUS = 'INVALID_BOOKING_STATUS',

  // Rate Limit Errors (429)
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',

  // Server Errors (5xx)
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  DATABASE_ERROR = 'DATABASE_ERROR',
  PAYMENT_GATEWAY_ERROR = 'PAYMENT_GATEWAY_ERROR',
  STELLAR_ERROR = 'STELLAR_ERROR',
  EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',
}

/**
 * Error metadata: Maps error codes to HTTP status and category
 */
export const ERROR_METADATA: Record<ErrorCode, {
  statusCode: number;
  category: ErrorCategory;
  description: string;
}> = {
  // Validation (400)
  [ErrorCode.INVALID_INPUT]: {
    statusCode: 400,
    category: ErrorCategory.VALIDATION,
    description: 'Input validation failed',
  },
  [ErrorCode.INVALID_EMAIL]: {
    statusCode: 400,
    category: ErrorCategory.VALIDATION,
    description: 'Invalid email format',
  },
  [ErrorCode.INVALID_PHONE]: {
    statusCode: 400,
    category: ErrorCategory.VALIDATION,
    description: 'Invalid phone number format',
  },
  [ErrorCode.INVALID_CURRENCY]: {
    statusCode: 400,
    category: ErrorCategory.VALIDATION,
    description: 'Unsupported currency',
  },
  [ErrorCode.INVALID_TIMEZONE]: {
    statusCode: 400,
    category: ErrorCategory.VALIDATION,
    description: 'Invalid timezone identifier',
  },
  [ErrorCode.INVALID_DURATION]: {
    statusCode: 400,
    category: ErrorCategory.VALIDATION,
    description: 'Invalid duration value',
  },
  [ErrorCode.MISSING_REQUIRED_FIELD]: {
    statusCode: 400,
    category: ErrorCategory.VALIDATION,
    description: 'Required field is missing',
  },

  // Authentication (401)
  [ErrorCode.UNAUTHORIZED]: {
    statusCode: 401,
    category: ErrorCategory.UNAUTHORIZED,
    description: 'Authentication required',
  },
  [ErrorCode.INVALID_CREDENTIALS]: {
    statusCode: 401,
    category: ErrorCategory.UNAUTHORIZED,
    description: 'Invalid username or password',
  },
  [ErrorCode.INVALID_TOKEN]: {
    statusCode: 401,
    category: ErrorCategory.UNAUTHORIZED,
    description: 'Invalid or malformed token',
  },
  [ErrorCode.TOKEN_EXPIRED]: {
    statusCode: 401,
    category: ErrorCategory.UNAUTHORIZED,
    description: 'Token has expired',
  },
  [ErrorCode.TOKEN_REVOKED]: {
    statusCode: 401,
    category: ErrorCategory.UNAUTHORIZED,
    description: 'Token has been revoked',
  },
  [ErrorCode.MFA_REQUIRED]: {
    statusCode: 401,
    category: ErrorCategory.UNAUTHORIZED,
    description: 'Multi-factor authentication required',
  },

  // Authorization (403)
  [ErrorCode.ACCESS_DENIED]: {
    statusCode: 403,
    category: ErrorCategory.FORBIDDEN,
    description: 'Access denied to this resource',
  },
  [ErrorCode.INSUFFICIENT_PERMISSIONS]: {
    statusCode: 403,
    category: ErrorCategory.FORBIDDEN,
    description: 'Insufficient permissions for this action',
  },
  [ErrorCode.ACCOUNT_SUSPENDED]: {
    statusCode: 403,
    category: ErrorCategory.FORBIDDEN,
    description: 'Account is suspended',
  },
  [ErrorCode.ACCOUNT_BANNED]: {
    statusCode: 403,
    category: ErrorCategory.FORBIDDEN,
    description: 'Account has been permanently banned',
  },
  [ErrorCode.MENTOR_UNAVAILABLE]: {
    statusCode: 403,
    category: ErrorCategory.FORBIDDEN,
    description: 'Mentor is not available',
  },

  // Not Found (404)
  [ErrorCode.USER_NOT_FOUND]: {
    statusCode: 404,
    category: ErrorCategory.NOT_FOUND,
    description: 'User not found',
  },
  [ErrorCode.MENTOR_NOT_FOUND]: {
    statusCode: 404,
    category: ErrorCategory.NOT_FOUND,
    description: 'Mentor not found',
  },
  [ErrorCode.MENTEE_NOT_FOUND]: {
    statusCode: 404,
    category: ErrorCategory.NOT_FOUND,
    description: 'Mentee not found',
  },
  [ErrorCode.BOOKING_NOT_FOUND]: {
    statusCode: 404,
    category: ErrorCategory.NOT_FOUND,
    description: 'Booking not found',
  },
  [ErrorCode.SESSION_NOT_FOUND]: {
    statusCode: 404,
    category: ErrorCategory.NOT_FOUND,
    description: 'Session not found',
  },
  [ErrorCode.PAYMENT_NOT_FOUND]: {
    statusCode: 404,
    category: ErrorCategory.NOT_FOUND,
    description: 'Payment not found',
  },
  [ErrorCode.WALLET_NOT_FOUND]: {
    statusCode: 404,
    category: ErrorCategory.NOT_FOUND,
    description: 'Wallet not found',
  },
  [ErrorCode.RESOURCE_NOT_FOUND]: {
    statusCode: 404,
    category: ErrorCategory.NOT_FOUND,
    description: 'Resource not found',
  },

  // Conflict (409)
  [ErrorCode.BOOKING_CONFLICT]: {
    statusCode: 409,
    category: ErrorCategory.CONFLICT,
    description: 'Booking conflict with existing booking',
  },
  [ErrorCode.DUPLICATE_BOOKING]: {
    statusCode: 409,
    category: ErrorCategory.CONFLICT,
    description: 'Duplicate booking already exists',
  },
  [ErrorCode.BOOKING_ALREADY_PAID]: {
    statusCode: 409,
    category: ErrorCategory.CONFLICT,
    description: 'Booking has already been paid',
  },
  [ErrorCode.RESOURCE_ALREADY_EXISTS]: {
    statusCode: 409,
    category: ErrorCategory.CONFLICT,
    description: 'Resource already exists',
  },
  [ErrorCode.MENTOR_TIME_SLOT_TAKEN]: {
    statusCode: 409,
    category: ErrorCategory.CONFLICT,
    description: 'Mentor time slot is already taken',
  },
  [ErrorCode.CONCURRENT_MODIFICATION]: {
    statusCode: 409,
    category: ErrorCategory.CONFLICT,
    description: 'Resource was modified concurrently',
  },

  // Unprocessable (422)
  [ErrorCode.INSUFFICIENT_FUNDS]: {
    statusCode: 422,
    category: ErrorCategory.UNPROCESSABLE,
    description: 'Insufficient funds for this operation',
  },
  [ErrorCode.INVALID_STATE_TRANSITION]: {
    statusCode: 422,
    category: ErrorCategory.UNPROCESSABLE,
    description: 'Invalid state transition',
  },
  [ErrorCode.PREREQUISITE_NOT_MET]: {
    statusCode: 422,
    category: ErrorCategory.UNPROCESSABLE,
    description: 'Prerequisites not met for this operation',
  },
  [ErrorCode.INVALID_BOOKING_STATUS]: {
    statusCode: 422,
    category: ErrorCategory.UNPROCESSABLE,
    description: 'Invalid booking status for this operation',
  },

  // Rate Limit (429)
  [ErrorCode.RATE_LIMIT_EXCEEDED]: {
    statusCode: 429,
    category: ErrorCategory.RATE_LIMIT,
    description: 'Rate limit exceeded',
  },

  // Server Errors (5xx)
  [ErrorCode.INTERNAL_SERVER_ERROR]: {
    statusCode: 500,
    category: ErrorCategory.INTERNAL,
    description: 'Internal server error',
  },
  [ErrorCode.SERVICE_UNAVAILABLE]: {
    statusCode: 503,
    category: ErrorCategory.SERVICE_UNAVAILABLE,
    description: 'Service temporarily unavailable',
  },
  [ErrorCode.DATABASE_ERROR]: {
    statusCode: 500,
    category: ErrorCategory.INTERNAL,
    description: 'Database error occurred',
  },
  [ErrorCode.PAYMENT_GATEWAY_ERROR]: {
    statusCode: 502,
    category: ErrorCategory.INTERNAL,
    description: 'Payment gateway error',
  },
  [ErrorCode.STELLAR_ERROR]: {
    statusCode: 502,
    category: ErrorCategory.INTERNAL,
    description: 'Stellar blockchain error',
  },
  [ErrorCode.EXTERNAL_SERVICE_ERROR]: {
    statusCode: 502,
    category: ErrorCategory.INTERNAL,
    description: 'External service error',
  },
};

/**
 * Structured error response returned to API consumers
 */
export interface ErrorResponse {
  status: 'error';
  code: ErrorCode;
  message: string; // User-friendly message (can be localized)
  category: ErrorCategory;
  requestId: string;
  timestamp: string;
  // Optional context for debugging (only in development)
  details?: {
    context?: Record<string, any>;
    retryable?: boolean;
    retryAfter?: number;
  };
}

/**
 * Extended Error interface for use throughout the application
 */
export interface AppErrorData {
  code: ErrorCode;
  message: string;
  statusCode?: number;
  context?: Record<string, any>;
  cause?: Error;
  retryable?: boolean;
  retryAfter?: number;
}
