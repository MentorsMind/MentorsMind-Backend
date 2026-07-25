import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { redis } from "../config/redis";
import pool from "../config/database";
import { logger } from "../utils/logger";
import { logAuditEvent, AUDIT_ACTIONS } from "../utils/audit.utils";

const CACHE_TTL = 30; // 30 seconds TTL for revoked keys cache invalidation
const RATE_LIMIT_WINDOW = 60 * 60; // 1 hour in seconds

export interface ApiKeyRequest extends Request {
  apiKey?: {
    id: string;
    userId: string;
    scopes: string[];
    rateLimit: number;
  };
}

interface ApiKeyRecord {
  id: string;
  owner_user_id: string;
  scopes: string[];
  rate_limit: number;
  is_active: boolean;
  expires_at: Date | null;
}

/**
 * Middleware to authenticate requests using API keys
 * 
 * Extracts API key from Authorization: ApiKey <key> header
 * Hashes the key with SHA-256 and looks up in database
 * Validates key is active, not expired, and not revoked
 * Uses Redis cache for performance
 */
export const authenticateApiKey = async (
  req: ApiKeyRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    
    // Check for ApiKey authorization header
    if (!authHeader || !authHeader.startsWith("ApiKey ")) {
      res.status(401).json({
        success: false,
        error: "API key required. Provide Authorization: ApiKey <your-key> header.",
      });
      return;
    }

    const rawKey = authHeader.split(" ")[1];
    if (!rawKey || rawKey.length < 20) {
      res.status(401).json({
        success: false,
        error: "Invalid API key format.",
      });
      return;
    }

    // Hash the API key with SHA-256
    const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");

    // Try cache first for revoked/invalid keys (negative cache)
    const cacheKey = `api_key:invalid:${keyHash}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached === "revoked") {
        res.status(401).json({
          success: false,
          error: "API key has been revoked.",
        });
        return;
      }
    } catch (err) {
      logger.warn("Redis cache check failed for API key", { error: err });
    }

    // Look up API key in database
    const { rows } = await pool.query<ApiKeyRecord>(
      `SELECT id, owner_user_id, scopes, rate_limit, is_active, expires_at
       FROM integration_api_keys
       WHERE key_hash = $1 AND provider = 'public'`,
      [keyHash]
    );

    const apiKey = rows[0];

    // Validate API key exists and is active
    if (!apiKey || !apiKey.is_active) {
      // Cache invalid/revoked keys for 30 seconds
      try {
        await redis.setex(cacheKey, CACHE_TTL, "revoked");
      } catch (err) {
        logger.warn("Failed to cache invalid API key", { error: err });
      }

      res.status(401).json({
        success: false,
        error: "Invalid or revoked API key.",
      });
      return;
    }

    // Check expiration
    if (apiKey.expires_at && new Date(apiKey.expires_at) <= new Date()) {
      try {
        await redis.setex(cacheKey, CACHE_TTL, "revoked");
      } catch (err) {
        logger.warn("Failed to cache expired API key", { error: err });
      }

      res.status(401).json({
        success: false,
        error: "API key has expired.",
      });
      return;
    }

    // Check rate limit for this API key
    const rateLimitKey = `api_key_rate_limit:${apiKey.id}`;
    const allowed = await checkRateLimit(
      rateLimitKey,
      apiKey.rate_limit,
      RATE_LIMIT_WINDOW
    );

    if (!allowed) {
      // Log rate limit exceeded
      await logAuditEvent({
        action: "API_KEY_RATE_LIMIT_EXCEEDED" as any,
        resourceType: "api_key",
        resourceId: apiKey.id,
        userId: apiKey.owner_user_id,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        metadata: {
          endpoint: req.path,
          method: req.method,
        },
      });

      res.status(429).json({
        success: false,
        error: `API key rate limit exceeded. Limit: ${apiKey.rate_limit} requests per hour.`,
        rateLimit: apiKey.rate_limit,
        retryAfter: RATE_LIMIT_WINDOW,
      });
      return;
    }

    // Update last_used_at asynchronously (fire and forget)
    pool.query(
      `UPDATE integration_api_keys 
       SET last_used_at = NOW(), updated_at = NOW() 
       WHERE id = $1`,
      [apiKey.id]
    ).catch((err) => {
      logger.error("Failed to update API key last_used_at", {
        keyId: apiKey.id,
        error: err.message,
      });
    });

    // Log API key usage to audit logs asynchronously
    logAuditEvent({
      action: "API_KEY_USED" as any,
      resourceType: "api_key",
      resourceId: apiKey.id,
      userId: apiKey.owner_user_id,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      metadata: {
        endpoint: req.path,
        method: req.method,
        scopes: apiKey.scopes,
      },
    }).catch((err) => {
      logger.error("Failed to log API key usage", { error: err });
    });

    // Attach API key info to request
    req.apiKey = {
      id: apiKey.id,
      userId: apiKey.owner_user_id,
      scopes: apiKey.scopes,
      rateLimit: apiKey.rate_limit,
    };

    // Set response headers
    res.setHeader("X-RateLimit-Limit", apiKey.rate_limit);
    res.setHeader("X-RateLimit-Window", "3600");

    next();
  } catch (error) {
    logger.error("API key authentication error", { error });
    res.status(500).json({
      success: false,
      error: "Internal server error during API key authentication.",
    });
  }
};

/**
 * Middleware to require specific API key permission/scope
 * 
 * @param permission - Required permission (e.g., "bookings:read", "webhooks:manage")
 * @returns Middleware function
 */
export const requireApiKeyPermission = (permission: string) => {
  return (req: ApiKeyRequest, res: Response, next: NextFunction): void => {
    if (!req.apiKey) {
      res.status(401).json({
        success: false,
        error: "API key authentication required.",
      });
      return;
    }

    const hasPermission = req.apiKey.scopes.includes(permission) || 
                         req.apiKey.scopes.includes("*");

    if (!hasPermission) {
      // Log permission denied
      logAuditEvent({
        action: "API_KEY_PERMISSION_DENIED" as any,
        resourceType: "api_key",
        resourceId: req.apiKey.id,
        userId: req.apiKey.userId,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        metadata: {
          endpoint: req.path,
          method: req.method,
          requiredPermission: permission,
          availableScopes: req.apiKey.scopes,
        },
      }).catch((err) => {
        logger.error("Failed to log permission denied", { error: err });
      });

      res.status(403).json({
        success: false,
        error: `Insufficient permissions. Required: ${permission}`,
        requiredPermission: permission,
      });
      return;
    }

    next();
  };
};

/**
 * Middleware that allows either JWT or API key authentication
 * 
 * Tries JWT first, then API key
 * Useful for endpoints that can be accessed by both users and external systems
 */
export const authenticateJwtOrApiKey = async (
  req: any,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const authHeader = req.headers.authorization;

  // Try JWT authentication first
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const { authenticate } = await import("./auth.middleware");
    return authenticate(req, res, next);
  }

  // Try API key authentication
  if (authHeader && authHeader.startsWith("ApiKey ")) {
    return authenticateApiKey(req, res, next);
  }

  res.status(401).json({
    success: false,
    error: "Authentication required. Provide either Bearer token or ApiKey in Authorization header.",
  });
};

/**
 * Rate limit checker using Redis sorted sets
 * Implements sliding window rate limiting
 * 
 * @param key - Redis key for this rate limit
 * @param limit - Maximum requests allowed in window
 * @param windowSeconds - Time window in seconds
 * @returns true if request is allowed, false if rate limited
 */
async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  try {
    const now = Date.now();
    const windowStart = now - windowSeconds * 1000;

    // Remove old entries outside the window
    await redis.zremrangebyscore(key, 0, windowStart);

    // Count requests in current window
    const count = await redis.zcard(key);

    if (count >= limit) {
      return false;
    }

    // Add current request
    await redis.zadd(key, now, `${now}`);

    // Set expiry on the key
    await redis.expire(key, windowSeconds);

    return true;
  } catch (err) {
    logger.error("Rate limit check failed", { key, error: err });
    // On Redis failure, allow request but log error
    return true;
  }
}

/**
 * Invalidate API key cache (call after revocation or rotation)
 */
export async function invalidateApiKeyCache(keyHash: string): Promise<void> {
  try {
    const cacheKey = `api_key:invalid:${keyHash}`;
    await redis.setex(cacheKey, CACHE_TTL, "revoked");
  } catch (err) {
    logger.warn("Failed to invalidate API key cache", { error: err });
  }
}
