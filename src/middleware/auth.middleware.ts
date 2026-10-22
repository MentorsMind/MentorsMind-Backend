import { Response, NextFunction } from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { logger } from "../utils/logger.utils";
import { createError } from "./errorHandler";
import { ErrorCode } from "../errors/error-codes";
import { CacheService } from "../services/cache.service";
import type { AuthenticatedRequest } from "../types/auth.types";


const JWT_SECRET = env.JWT_SECRET;
const LAST_ACTIVE_DEBOUNCE_MS = 60 * 1000; // 1 minute
const LAST_ACTIVE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

export const lastActiveDebounce = new Map<
  string,
  { timestamp: number; expiresAt: number }
>();

const lastActiveCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [userId, entry] of lastActiveDebounce) {
    if (entry.expiresAt <= now) {
      lastActiveDebounce.delete(userId);
    }
  }
}, LAST_ACTIVE_CLEANUP_INTERVAL_MS);
lastActiveCleanupInterval.unref();

export const stopAuthDebounceCleanup = (): void => {
  clearInterval(lastActiveCleanupInterval);
};

// ── Token revocation cache ──────────────────────────────────────────────────
const DURATION_UNIT_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
};

/** Convert a JWT-style duration ("15m", "1h", "900") to seconds. */
export function jwtExpiryToSeconds(value: string): number {
  const match = /^(\d+)\s*([smhd])?$/.exec(value.trim());
  if (!match) return 15 * 60;
  return parseInt(match[1], 10) * DURATION_UNIT_SECONDS[match[2] ?? "s"];
}

const REVOCATION_CACHE_TTL_SECONDS = jwtExpiryToSeconds(env.JWT_EXPIRES_IN);

/** Cache key for a token's revocation verdict; the raw token is never stored. */
export const revocationCacheKey = (token: string): string =>
  `revoked:${crypto.createHash("sha256").update(token).digest("hex")}`;

export const REVOCATION_CACHE_TTL = REVOCATION_CACHE_TTL_SECONDS;

// Re-exported so existing `AuthenticatedRequest` imports from this module keep working.
export type { AuthenticatedRequest };

export const authenticate = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({
        success: false,
        error: "Authentication required. Please provide a valid Bearer token.",
      });
      return;
    }

    const token = authHeader.split(" ")[1];

    // Decode header to extract kid for RSA key lookup
    const header = jwt.decode(token, { complete: true })?.header as {
      kid?: string;
      alg?: string;
    } | null;

    let decoded: {
      sub: string;
      role: string;
      iat?: number;
      exp?: number;
      jti?: string;
      mfaVerified?: boolean;
      isImpersonation?: boolean;
      impersonatedBy?: string;
      impersonationSessionId?: string;
    };

    if (header?.kid && header?.alg === "RS256") {
      // ── RSA-256 path: look up the public key by kid ──
      const { JwksService } = await import("../services/jwks.service");
      const keyPair = await JwksService.getKeyById(header.kid);

      if (!keyPair) {
        res.status(401).json({ success: false, error: "Unknown signing key." });
        return;
      }

      // Reject tokens signed with the previous key if it's past the 24-hour window
      const current = await JwksService.getCurrentKey();
      if (
        keyPair.kid !== current?.kid &&
        !(JwksService as any).isPreviousKeyValid(keyPair)
      ) {
        res.status(401).json({
          success: false,
          error: "Signing key has expired. Please log in again.",
        });
        return;
      }

      decoded = jwt.verify(token, keyPair.publicKeyPem, {
        algorithms: ["RS256"],
      }) as { sub: string; role: string; mfaVerified?: boolean };
    } else {
      // ── HMAC fallback: handles tokens issued before RSA migration ──
      try {
        decoded = jwt.verify(token, JWT_SECRET) as {
          sub: string;
          role: string;
          mfaVerified?: boolean;
          isImpersonation?: boolean;
          impersonatedBy?: string;
          impersonationSessionId?: string;
        };
      } catch (err) {
        // Accept previous secret during rotation window (JWT_SECRET_PREVIOUS)
        if (env.JWT_SECRET_PREVIOUS) {
          decoded = jwt.verify(token, env.JWT_SECRET_PREVIOUS) as {
            sub: string;
            role: string;
            mfaVerified?: boolean;
            isImpersonation?: boolean;
            impersonatedBy?: string;
            impersonationSessionId?: string;
          };
        } else {
          throw err;
        }
      }
    }

    const userId = decoded.sub;
    const issuedAtMs =
      typeof decoded.iat === "number" ? decoded.iat * 1000 : Date.now();
    const isRevoked = await isTokenRevokedCached(
      token,
      userId,
      issuedAtMs,
      decoded.jti,
      decoded.exp,
    );
    if (isRevoked) {
      res.status(401).json({
        success: false,
        error: "Token has been revoked. Please log in again.",
      });
      return;
    }

    // ── Impersonation token validation ──────────────────────────────────────
    if (decoded.isImpersonation && decoded.impersonationSessionId) {
      const { ImpersonationService } = await import("../services/impersonation.service");
      const sessionValid = await ImpersonationService.validateSession(
        decoded.impersonationSessionId,
      );
      if (!sessionValid) {
        res.status(401).json({
          success: false,
          error: "Impersonation session has expired or been terminated.",
        });
        return;
      }
    }

    req.user = {
      id: userId,
      userId,
      role: decoded.role,
      mfaVerified: !!decoded.mfaVerified,
      isImpersonation: decoded.isImpersonation ?? false,
      impersonatedBy: decoded.impersonatedBy,
      impersonationSessionId: decoded.impersonationSessionId,
    } as any;

    // Debounced last_active_at update — max once per minute per user
    const now = Date.now();
    const lastUpdate = lastActiveDebounce.get(userId)?.timestamp ?? 0;

    if (now - lastUpdate >= LAST_ACTIVE_DEBOUNCE_MS) {
      lastActiveDebounce.set(userId, {
        timestamp: now,
        expiresAt: now + LAST_ACTIVE_DEBOUNCE_MS * 2,
      });
      pool_updateLastActive(userId).catch((err: any) =>
        logger.error("Failed to update session last_active_at", {
          userId,
          error: err.message,
        }),
      );
    }


    if (!req.user?.id || !req.user?.userId) {
      throw createError(ErrorCode.AUTH_UNAUTHORIZED, 401, { reason: "req.user is undefined or missing id/userId" });
    }

    next();
  } catch (error: any) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({
        success: false,
        error: "Token expired.",
        code: "TOKEN_EXPIRED",
      });
      return;
    }
    if (error?.code === ErrorCode.AUTH_UNAUTHORIZED) {
      return next(error);
    }
    res.status(401).json({
      success: false,
      error: "Invalid token.",
      code: "TOKEN_INVALID",
    });
  }
};

/**
 * Update last_active_at for all active sessions belonging to a user.
 */
async function pool_updateLastActive(userId: string): Promise<void> {
  const pool = (await import("../config/database")).default;
  await pool.query(
    `UPDATE user_sessions
     SET last_active_at = NOW()
     WHERE user_id = $1
       AND revoked_at IS NULL
       AND expires_at > NOW()
       AND last_active_at < NOW() - INTERVAL '1 minute'`,
    [userId],
  );
}

/**
 * Redis-backed wrapper around isTokenRevokedForUser. Cached value is the
 * string "revoked" or "valid"; TTL equals the access token lifetime.
 */
export async function isTokenRevokedCached(
  token: string,
  userId: string,
  issuedAtMs: number,
  tokenJti?: string,
  tokenExpiresAt?: number,
): Promise<boolean> {
  const key = revocationCacheKey(token);
  const cached = await CacheService.get<string>(key);
  if (cached === "revoked") return true;
  if (cached === "valid") return false;

  const revoked = await isTokenRevokedForUser(
    userId,
    issuedAtMs,
    tokenJti,
    tokenExpiresAt,
  );
  await CacheService.set(
    key,
    revoked ? "revoked" : "valid",
    REVOCATION_CACHE_TTL_SECONDS,
  );
  return revoked;
}

async function isTokenRevokedForUser(
  userId: string,
  issuedAtMs: number,
  tokenJti?: string,
  tokenExpiresAt?: number,
): Promise<boolean> {
  const cacheKey = tokenJti
    ? `token:revoked:${userId}:${tokenJti}`
    : undefined;
  const cacheCandidate = cacheKey
    ? await CacheService.get<boolean>(cacheKey)
    : null;
  const cacheAvailable = CacheService.isDistributed();
  if (cacheAvailable && cacheCandidate !== null) return cacheCandidate;

  const pool = (await import("../config/database")).default;
  const { rows } = await pool.query(
    `SELECT token_invalid_before, deletion_completed_at,
            EXISTS (
              SELECT 1 FROM token_blacklist
               WHERE token_jti = $2 AND expires_at > NOW()
            ) AS token_blacklisted
       FROM users
      WHERE id = $1`,
    [userId, tokenJti ?? null],
  );

  const user = rows[0];
  if (!user) {
    return true;
  }

  const isRevoked =
    !!user.deletion_completed_at ||
    !!user.token_blacklisted ||
    (user.token_invalid_before instanceof Date &&
      issuedAtMs <= user.token_invalid_before.getTime());

  const ttlSeconds =
    typeof tokenExpiresAt === "number"
      ? Math.max(0, tokenExpiresAt - Math.floor(Date.now() / 1000))
      : 0;
  if (cacheAvailable && cacheKey && ttlSeconds > 0) {
    await CacheService.set(cacheKey, isRevoked, ttlSeconds);
  }

  return isRevoked;
}

export const requireRole = (roles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: "Access denied. Insufficient permissions.",
      });
    }

    next();
  };
};
