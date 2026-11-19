import { Request, Response, NextFunction } from "express";
import { RateLimiterService } from "../services/rate-limiter.service";
import { stellarService } from "../services/stellar.service";
import { rateLimitExceededTotal, stellarVerificationAttemptsTotal } from "../config/metrics";
import { isAdminRequest, setRateLimitHeaders } from "../utils/rate-limit.utils";

const VERIFICATION_LIMIT = 5;
const VERIFICATION_WINDOW_MS = 60 * 1000;

function getUserId(req: Request): string {
  const userId = (req as any).user?.id || (req as any).user?.userId;
  if (userId) return String(userId);

  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress || "unknown";
  return `ip:${ip}`;
}

export async function stellarVerificationRateLimit(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (isAdminRequest(req)) {
    res.setHeader("X-RateLimit-Bypass", "admin");
    return next();
  }

  const userId = getUserId(req);
  const backoff = await stellarService.getVerificationBackoff(userId);
  const now = Date.now();
  if (backoff && backoff.blockedUntil > now) {
    const retryAfter = Math.max(1, Math.ceil((backoff.blockedUntil - now) / 1000));
    stellarVerificationAttemptsTotal.inc({ outcome: "backoff" });
    res.setHeader("Retry-After", retryAfter);
    res.status(429).json({
      status: "error",
      message: "Verification temporarily blocked after failed attempts. Please try again later.",
      retryAfter,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const result = await RateLimiterService.check(
    `stellar-verification:${userId}`,
    VERIFICATION_WINDOW_MS,
    VERIFICATION_LIMIT,
  );
  setRateLimitHeaders(res, result);

  if (!result.allowed) {
    rateLimitExceededTotal.inc({ tier: "user", endpoint_category: "stellar-verification" });
    stellarVerificationAttemptsTotal.inc({ outcome: "rate_limited" });
    const retryAfter = Math.max(1, Math.ceil((result.resetTime.getTime() - now) / 1000));
    res.setHeader("Retry-After", retryAfter);
    res.status(429).json({
      status: "error",
      message: "Too many Stellar transaction verification attempts. Please try again later.",
      retryAfter,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  stellarVerificationAttemptsTotal.inc({ outcome: "allowed" });
  res.once("finish", () => {
    if (res.statusCode >= 400) {
      stellarVerificationAttemptsTotal.inc({ outcome: "failed" });
      void stellarService.recordVerificationFailure(userId);
    } else {
      void stellarService.resetVerificationFailures(userId);
    }
  });
  next();
}