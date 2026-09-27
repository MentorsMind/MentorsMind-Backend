import { Request, Response, NextFunction } from 'express';

/**
 * Middleware that sets Cache-Control and Pragma headers to prevent response caching
 * on authentication and sensitive user data endpoints.
 */
export function noCacheMiddleware(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader('Cache-Control', 'no-store, no-cache, private');
  res.setHeader('Pragma', 'no-cache');
  next();
}
