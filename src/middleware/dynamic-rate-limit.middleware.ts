import { NextFunction, Request, Response } from "express";
import {
  EndpointCategory,
} from "../services/rate-limiter.service";
import {
  IntelligentRateLimiterService,
  intelligentRateLimiterService,
} from "../services/intelligent-rate-limiter.service";
import { resolveBusinessTier } from "../config/rate-limit-rules";
import { isAdminRequest, setRateLimitHeaders } from "../utils/rate-limit.utils";

export interface DynamicRateLimitOptions {
  category?: EndpointCategory;
  keyStrategy?: "ip" | "user";
  message?: string;
  skip?: (req: Request) => boolean;
  service?: IntelligentRateLimiterService;
}

function resolveIp(req: Request): string {
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

function resolveKey(req: Request, keyStrategy: "ip" | "user", category: EndpointCategory): string {
  const userId = resolveUserId(req);
  const identity = keyStrategy === "user" && userId ? `user:${userId}` : `ip:${resolveIp(req)}`;
  return `${identity}:${category}`;
}

export function dynamicRateLimitMiddleware(options: DynamicRateLimitOptions = {}) {
  const {
    category = "general",
    keyStrategy = "user",
    message = "Too many requests. Please try again later.",
    service = intelligentRateLimiterService,
  } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (options.skip?.(req) || isAdminRequest(req)) {
      if (isAdminRequest(req)) res.setHeader("X-RateLimit-Bypass", "admin");
      return next();
    }

    const tier = resolveBusinessTier((req as any).user);
    if (tier === "enterprise") {
      res.setHeader("X-RateLimit-Tier", tier);
      res.setHeader("X-RateLimit-Bypass", "tier");
      return next();
    }

    const result = await service.check(resolveKey(req, keyStrategy, category), {
      tier,
      category,
    });
    res.setHeader("X-RateLimit-Tier", tier);
    res.setHeader("X-RateLimit-Category", category);
    res.setHeader("X-RateLimit-Load", result.loadBand);
    setRateLimitHeaders(res, result);

    (req as any).rateLimitInfo = result;
    if (!result.allowed) {
      const retryAfter = Math.max(1, Math.ceil((result.resetTime.getTime() - Date.now()) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({
        error: "Rate limit exceeded",
        message,
        retryAfter,
        limit: result.limit,
        remaining: result.remaining,
        tier,
        category,
        loadBand: result.loadBand,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    next();
  };
}

export const dynamicApiRateLimiter = dynamicRateLimitMiddleware({ category: "general" });