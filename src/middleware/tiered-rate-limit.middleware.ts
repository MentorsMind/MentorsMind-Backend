/**
 * Tiered rate limiting middleware.
 * Limits are applied per user based on their subscription tier.
 * Enterprise users are bypassed entirely.
 */
import { Request, Response, NextFunction } from "express";
import { RateLimiterService } from "../services/rate-limiter.service";
import {
  userKey,
  ipKey,
  isAdminRequest,
  setRateLimitHeaders,
  buildRateLimitEvent,
  logRateLimitEvent,
} from "../utils/rate-limit.utils";

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: Date;
  tier: string;
}

const RATE_LIMITS = {
  free: { requests: 100, window: 15 * 60 * 1000 },
  pro: { requests: 1000, window: 15 * 60 * 1000 },
  premium: { requests: 10000, window: 15 * 60 * 1000 },
  enterprise: { requests: 100000, window: 15 * 60 * 1000 },
} as const;

type Tier = keyof typeof RATE_LIMITS;

function resolveTier(req: Request): Tier {
  const user = (req as any).user;
  const raw = (user?.userTier ?? user?.user_tier ?? "free").toLowerCase();
  return (raw in RATE_LIMITS ? raw : "free") as Tier;
}

/**
 * Middleware factory — returns a middleware that enforces tier-based limits.
 * Pass `fallbackToIp: true` for unauthenticated routes (uses IP as key).
 */
export function tieredRateLimit(options: { fallbackToIp?: boolean } = {}) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    if (isAdminRequest(req)) {
      res.setHeader("X-RateLimit-Bypass", "admin");
      return next();
    }

    const tier = resolveTier(req);

    if (tier === "enterprise") {
      res.setHeader("X-RateLimit-Tier", "enterprise");
      res.setHeader("X-RateLimit-Bypass", "tier");
      return next();
    }

    const { requests: max, window: windowMs } = RATE_LIMITS[tier];
    const key = (req as any).user
      ? userKey(req)
      : options.fallbackToIp
        ? ipKey(req)
        : userKey(req);

    const result = await RateLimiterService.check(key, windowMs, max);

    const info: RateLimitInfo = {
      limit: result.limit,
      remaining: result.remaining,
      reset: result.resetTime,
      tier,
    };

    res.setHeader("X-RateLimit-Tier", tier);
    setRateLimitHeaders(res, {
      limit: result.limit,
      current: result.current,
      remaining: result.remaining,
      resetTime: result.resetTime,
    });

    // Soft warning at 80% usage
    if (result.remaining <= Math.floor(result.limit * 0.2)) {
      res.setHeader("X-RateLimit-Warning", "approaching limit");
    }

    const event = buildRateLimitEvent(
      req,
      key,
      !result.allowed,
      result.remaining,
    );
    logRateLimitEvent(event);

    if (!result.allowed) {
      res.setHeader(
        "Retry-After",
        Math.ceil((result.resetTime.getTime() - Date.now()) / 1000),
      );
      res.status(429).json({
        status: "error",
        message: `Rate limit exceeded for ${tier} tier. Upgrade your subscription for higher limits.`,
        rateLimitInfo: info,
        retryAfter: result.resetTime.toISOString(),
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Attach info to request for downstream use
    (req as any).rateLimitInfo = info;
    next();
  };
}

/** Pre-built instance for authenticated API routes */
export const tieredApiLimiter = tieredRateLimit();

/** Pre-built instance for public routes (falls back to IP) */
export const tieredPublicLimiter = tieredRateLimit({ fallbackToIp: true });
