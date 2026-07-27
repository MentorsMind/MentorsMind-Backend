import { Request } from 'express';
import { ErrorCode, ErrorCategory } from './errors.types';

/**
 * Success response from the API
 */
export interface ApiSuccessResponse<T = any> {
  status: 'success';
  data?: T;
  message?: string;
  meta?: PaginationMeta;
  requestId: string;
  timestamp: string;
}

/**
 * Error response from the API with structured error codes
 * 
 * @see /docs/ERROR_HANDLING.md for complete error code reference
 * 
 * @example
 * {
 *   "status": "error",
 *   "code": "BOOKING_CONFLICT",
 *   "message": "Mentor is not available at 2:00 PM",
 *   "category": "CONFLICT",
 *   "requestId": "req-abc123",
 *   "timestamp": "2026-07-27T10:30:00Z",
 *   "details": {
 *     "context": {
 *       "conflictingSession": { "start": "...", "end": "..." }
 *     },
 *     "retryable": false
 *   }
 * }
 */
export interface ApiErrorResponse {
  status: 'error';
  code: ErrorCode;
  message: string;
  category: ErrorCategory;
  requestId: string;
  timestamp: string;
  details?: {
    context?: Record<string, any>;
    retryable?: boolean;
    retryAfter?: number;
  };
}

/**
 * Legacy API response format (for backward compatibility)
 * @deprecated Use ApiSuccessResponse or ApiErrorResponse instead
 */
export interface ApiResponse<T = any> {
  status: 'success' | 'error' | 'fail';
  message?: string;
  data?: T;
  error?: string;
  errors?: ValidationError[];
  meta?: PaginationMeta;
  timestamp: string;
}

export interface ValidationError {
  field: string;
  message: string;
  code?: string;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface AuthenticatedRequest extends Request {
  user?: Express.User;
}

export interface PaginationQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}
