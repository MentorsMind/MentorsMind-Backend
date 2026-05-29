import { Request } from 'express';

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
  user?: {
    id: string;
    userId?: string;
    email: string;
    role: string;
  };
}

export interface PaginationQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}
