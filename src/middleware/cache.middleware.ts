import { Request, Response, NextFunction } from 'express';
import { CacheService } from '../services/cache.service';
import { CacheTTL } from '../utils/cache-key.utils';

// Shared context for tracking cache hits in this request
export interface CacheContext {
  isHit: boolean;
  key: string;
}

export const cacheContextKey = Symbol('cacheContext');

/**
 * Cache middleware factory.
 * Caches GET responses by URL (+ optional custom key).
 * Skips caching for authenticated requests unless `cacheAuthenticated` is true.
 * Adds X-Cache: HIT|MISS header for debugging.
 *
 * @example
 * router.get('/mentors', cacheMiddleware({ ttl: CacheTTL.medium }), handler);
 */
export function cacheMiddleware(options: {
  ttl?: number;
  keyFn?: (req: Request) => string;
  cacheAuthenticated?: boolean;
}) {
  const { ttl = CacheTTL.medium, keyFn, cacheAuthenticated = false } = options;

  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    // Only cache GET requests
    if (req.method !== 'GET') return next();

    // Skip authenticated requests unless explicitly opted in
    const isAuthed = !!(req as any).user;
    if (isAuthed && !cacheAuthenticated) return next();

    // When caching authenticated responses, scope the key to the user to
    // prevent one user's private data from being served to another user.
    const userId = (req as any).user?.userId ?? (req as any).user?.id;
    if (cacheAuthenticated && !userId) return next();

    const defaultKey = cacheAuthenticated
      ? `mm:http:${userId}:${req.originalUrl}`
      : `mm:http:${req.originalUrl}`;
    const key = keyFn ? keyFn(req) : defaultKey;
    const cached = await CacheService.get<{ status: number; body: unknown }>(
      key,
    );

    if (cached) {
      // Mark request as cache hit and set header
      (req as any)[cacheContextKey] = { isHit: true, key } as CacheContext;
      res.setHeader('X-Cache', 'HIT');
      res.status(cached.status).json(cached.body);
      return;
    }

    // Mark as cache miss
    (req as any)[cacheContextKey] = { isHit: false, key } as CacheContext;
    res.setHeader('X-Cache', 'MISS');

    // Intercept res.json to capture the response
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      if (res.statusCode < 400) {
        CacheService.set(key, { status: res.statusCode, body }, ttl).catch(
          () => {},
        );
      }
      return originalJson(body);
    };

    next();
  };
}

/**
 * Middleware that adds cache metrics to the response headers (dev/admin use).
 * Displays aggregate cache hit/miss rates and which backend is active.
 */
export function cacheMetricsMiddleware(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  const m = CacheService.getMetrics();
  const total = m.hits + m.misses;
  const hitRate = total > 0 ? ((m.hits / total) * 100).toFixed(1) : '0.0';
  res.setHeader('X-Cache-Hits', m.hits);
  res.setHeader('X-Cache-Misses', m.misses);
  res.setHeader('X-Cache-Hit-Rate', `${hitRate}%`);
  res.setHeader(
    'X-Cache-Backend',
    CacheService.isDistributed() ? 'redis' : 'memory',
  );
  next();
}
