import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { logger } from './logger.utils';

// ─── Key Generators ──────────────────────────────────────────────────────────

/**
 * IP-based key — used for unauthenticated / general limiting.
 */
export function ipKey(req: Request): string {
  const ip =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown';
  return `rl:ip:${ip}`;
}

/**
 * User-based key — used for authenticated requests.
 * Falls back to IP when no user is present.
 */
export function userKey(req: Request): string {
  const authReq = req as AuthenticatedRequest;
  if (authReq.user?.id) {
    return `rl:user:${authReq.user.id}`;
  }
  return ipKey(req);
}

/**
 * Endpoint-scoped key combining IP + route path.
 */
export function endpointKey(req: Request): string {
  const ip =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown';
  const route = req.route?.path ?? req.path;
  return `rl:endpoint:${ip}:${route}`;
}

// ─── Admin Bypass ─────────────────────────────────────────────────────────────

/**
 * Returns true when the request belongs to an admin user.
 * Admins are exempt from rate limiting.
 */
export function isAdminRequest(req: Request): boolean {
  const authReq = req as AuthenticatedRequest;
  return authReq.user?.role === 'admin';
}

// ─── Header Helpers ───────────────────────────────────────────────────────────

export interface RateLimitInfo {
  limit: number;
  current: number;
  remaining: number;
  resetTime: Date;
}

/**
 * Attaches X-RateLimit-* headers to the response.
 */
export function setRateLimitHeaders(res: Response, info: RateLimitInfo): void {
  res.setHeader('X-RateLimit-Limit', info.limit);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, info.remaining));
  res.setHeader('X-RateLimit-Reset', Math.ceil(info.resetTime.getTime() / 1000));
  res.setHeader('X-RateLimit-Used', info.current);
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export interface RateLimitEvent {
  key: string;
  endpoint: string;
  method: string;
  ip: string;
  userId?: string;
  timestamp: string;
  blocked: boolean;
  remaining: number;
}

/**
 * Logs a rate-limit event for monitoring / alerting.
 * Emits a warn when a request is blocked, debug otherwise.
 */
export function logRateLimitEvent(event: RateLimitEvent): void {
  if (event.blocked) {
    logger.warn('Rate limit exceeded', {
      key: event.key,
      endpoint: event.endpoint,
      method: event.method,
      ip: event.ip,
      userId: event.userId,
      timestamp: event.timestamp,
    });
  } else if (event.remaining <= 5) {
    // Approaching limit — useful for alerting
    logger.debug('Rate limit approaching', {
      key: event.key,
      remaining: event.remaining,
      endpoint: event.endpoint,
    });
  }
}

/**
 * Builds a RateLimitEvent from an express Request.
 */
export function buildRateLimitEvent(
  req: Request,
  key: string,
  blocked: boolean,
  remaining: number
): RateLimitEvent {
  const authReq = req as AuthenticatedRequest;
  const ip =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown';

  return {
    key,
    endpoint: req.path,
    method: req.method,
    ip,
    userId: authReq.user?.id,
    timestamp: new Date().toISOString(),
    blocked,
    remaining,
  };
}
