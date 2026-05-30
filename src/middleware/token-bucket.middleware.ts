/**
 * Token Bucket Rate Limit Middleware
 *
 * Integrates TokenBucketLimiter with Express.
 * - Trusted IPs bypass all limits
 * - Admin users bypass all limits
 * - Attaches X-RateLimit-* headers
 * - Supports all three algorithms via config
 */

import { Request, Response, NextFunction } from "express";
import {
  TokenBucketLimiter,
  RateLimitConfig,
  isTrustedIP,
} from "../utils/token-bucket-limiter";
import { isAdminRequest, ipKey, userKey } from "../utils/rate-limit.utils";

export type KeyStrategy = "ip" | "user";

export interface TokenBucketMiddlewareOptions {
  config: RateLimitConfig;
  keyStrategy?: KeyStrategy;
  /** Message returned in 429 response */
  message?: string;
  /** Skip rate limiting entirely (useful for testing) */
  skip?: (req: Request) => boolean;
}

function resolveIP(req: Request): string {
  return (
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

/**
 * Factory that returns an Express middleware enforcing token-bucket rate limits.
 */
export function tokenBucketMiddleware(options: TokenBucketMiddlewareOptions) {
  const {
    config,
    keyStrategy = "ip",
    message = "Too many requests. Please slow down.",
  } = options;

  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    // Custom skip predicate
    if (options.skip?.(req)) return next();

    // Admin bypass
    if (isAdminRequest(req)) {
      res.setHeader("X-RateLimit-Bypass", "admin");
      return next();
    }

    // Trusted IP bypass
    const ip = resolveIP(req);
    if (isTrustedIP(ip)) {
      res.setHeader("X-RateLimit-Bypass", "trusted-ip");
      return next();
    }

    const key = keyStrategy === "user" ? userKey(req) : ipKey(req);
    const result = await TokenBucketLimiter.consume(key, config);

    res.setHeader("X-RateLimit-Limit", result.capacity);
    res.setHeader("X-RateLimit-Remaining", Math.floor(result.tokensRemaining));
    res.setHeader("X-RateLimit-Algorithm", result.algorithm);

    if (!result.allowed) {
      res.setHeader("Retry-After", Math.ceil(result.retryAfterMs / 1000));
      res.status(429).json({
        status: "error",
        message,
        retryAfterMs: result.retryAfterMs,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    next();
  };
}

// ─── Pre-built instances ──────────────────────────────────────────────────────

/** Standard API limiter: 60 req/min with burst of 20 */
export const tokenBucketApiLimiter = tokenBucketMiddleware({
  config: {
    algorithm: "token-bucket",
    capacity: 60,
    refillRate: 1, // 1 token/sec = 60/min
    burstSize: 20,
    dynamicAdjustment: true,
  },
  keyStrategy: "user",
});

/** Auth limiter: 10 req/15min, no burst */
export const tokenBucketAuthLimiter = tokenBucketMiddleware({
  config: {
    algorithm: "token-bucket",
    capacity: 10,
    refillRate: 0.011, // ~10 per 15 min
    burstSize: 5,
    dynamicAdjustment: false,
  },
  keyStrategy: "ip",
  message: "Too many authentication attempts. Please try again later.",
});

/** Strict limiter for sensitive endpoints: 5 req/hour */
export const tokenBucketSensitiveLimiter = tokenBucketMiddleware({
  config: {
    algorithm: "sliding-window",
    capacity: 5,
    refillRate: 0.0014, // ~5 per hour
    burstSize: 5,
    dynamicAdjustment: false,
  },
  keyStrategy: "ip",
  message: "Too many sensitive requests. Please try again later.",
});
