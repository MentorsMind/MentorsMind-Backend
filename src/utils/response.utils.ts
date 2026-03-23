import { Response } from 'express';
import { ApiResponse, PaginationMeta, ValidationError } from '../types/api.types';

export class ResponseUtil {
  static success<T>(
    res: Response,
    data: T,
    message?: string,
    statusCode: number = 200,
    meta?: PaginationMeta
  ): Response {
    const response: ApiResponse<T> = {
      status: 'success',
      message,
      data,
      timestamp: new Date().toISOString(),
    };

    if (meta) {
      response.meta = meta;
    }

    return res.status(statusCode).json(response);
  }

  static error(
    res: Response,
    message: string,
    statusCode: number = 500,
    error?: string
  ): Response {
    const response: ApiResponse = {
      status: 'error',
      message,
      error,
      timestamp: new Date().toISOString(),
    };

    return res.status(statusCode).json(response);
  }

  static validationError(
    res: Response,
    errors: ValidationError[],
    message: string = 'Validation failed'
  ): Response {
    const response: ApiResponse = {
      status: 'fail',
      message,
      errors,
      timestamp: new Date().toISOString(),
    };

    return res.status(400).json(response);
  }

  static created<T>(res: Response, data: T, message?: string): Response {
    return this.success(res, data, message, 201);
  }

  static noContent(res: Response): Response {
    return res.status(204).send();
  }

  static unauthorized(res: Response, message: string = 'Unauthorized'): Response {
    return this.error(res, message, 401);
  }

  static forbidden(res: Response, message: string = 'Forbidden'): Response {
    return this.error(res, message, 403);
  }

  static notFound(res: Response, message: string = 'Resource not found'): Response {
    return this.error(res, message, 404);
  }

  static conflict(res: Response, message: string = 'Resource conflict'): Response {
    return this.error(res, message, 409);
  }
}
