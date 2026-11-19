import { Request, Response, NextFunction } from "express";
import {
  RateLimiterService,
  SlidingWindowResult,
  UserTier,
  EndpointCategory,
} from "../services/rate-limiter.service";
import { isAdminRequest, setRateLimitHeaders } from "../utils/rate-limit.utils";
import { rateLimitExceededTotal } from "../config/metrics";

export interface DistributedRateLimitOptions {
  category?: EndpointCategory;
  fallbackToIp?: boolean;
}

function resolveTier(req: Request): UserTier {
  const user = (req as any).user;
  const raw = (user?.userTier ?? user?.user_tier ?? "free").toLowerCase();
  if (["free", "pro", "enterprise"].includes(raw)) {
    return raw as UserTier;
  }
  return "free";
}

function resolveIP(req: Request): string {
  return (
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

function resolveUserId(req: Request): string | null {
  const user = (req as any).user;
  return user?.id || user?.userId || null;
}

function buildRateLimitKey(
  req: Request,
  category: EndpointCategory,
  fallbackToIp: boolean
): string {
  const userId = resolveUserId(req);
  if (userId) {
    return `user:${userId}:${category}`;
  }
  if (fallbackToIp) {
    const ip = resolveIP(req);
    return `ip:${ip}:${category}`;
  }
  const ip = resolveIP(req);
  return `ip:${ip}:${category}`;
}

export function distributedRateLimit(options: DistributedRateLimitOptions = {}) {
  const {
    category = "general",
    fallbackToIp = true,
  } = options;

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

    const tierLimit = RateLimiterService.getTierLimit(tier);
    const categoryLimit = RateLimiterService.getCategoryLimit(category);

    // Apply the stricter of the two limits
    let max: number;
    let windowMs: number;
    if (categoryLimit.max < tierLimit.max) {
      max = categoryLimit.max;
      windowMs = categoryLimit.windowMs;
    } else {
      max = tierLimit.max;
      windowMs = tierLimit.windowMs;
    }

    const key = buildRateLimitKey(req, category, fallbackToIp);
    const result: SlidingWindowResult = await RateLimiterService.check(
      key,
      windowMs,
      max
    );

    res.setHeader("X-RateLimit-Tier", tier);
    res.setHeader("X-RateLimit-Category", category);
    setRateLimitHeaders(res, {
      limit: result.limit,
      current: result.current,
      remaining: result.remaining,
      resetTime: result.resetTime,
    });

    if (!result.allowed) {
      // Increment Prometheus counter
      rateLimitExceededTotal.inc({ tier, endpoint_category: category });

      // Calculate Retry-After header (seconds until reset)
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((result.resetTime.getTime() - Date.now()) / 1000)
      );
      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.setHeader("X-Rate-Limit-Scope", category);

      res.status(429).json({
        error: "Rate limit exceeded",
        retryAfter: retryAfterSeconds,
        limit: result.limit,
        remaining: result.remaining,
        tier,
        category,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Attach info to request for downstream use
    (req as any).rateLimitInfo = {
      tier,
      category,
      result,
    };
    next();
  };
}

export const distributedAuthLimiter = distributedRateLimit({ category: "auth" });
export const distributedPaymentLimiter = distributedRateLimit({ category: "payment" });
export const distributedFileUploadLimiter = distributedRateLimit({ category: "file-upload" });
export const distributedGeneralLimiter = distributedRateLimit({ category: "general" });
