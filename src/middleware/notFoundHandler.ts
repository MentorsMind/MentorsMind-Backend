import { Request, Response } from 'express';
import { ErrorCode } from '../errors/error-codes';

export const notFoundHandler = (req: Request, res: Response) => {
  const requestId = res.locals?.requestId || req.headers['x-request-id'];

  const responseBody = {
    status: 'error',
    code: ErrorCode.NOT_FOUND,
    message: `Route ${req.method} ${req.originalUrl} not found`,
    ...(requestId && { requestId }),
    timestamp: new Date().toISOString(),
  };

  res.status(404).json(responseBody);
};
