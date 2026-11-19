/**
 * Session Validation Middleware
 *
 * Tracks session fingerprints (IP address, User-Agent, geo-location) and
 * invalidates sessions when suspicious activity is detected.
 *
 * Runs after the JWT `authenticate` middleware.  It is intentionally
 * fail-open so that transient errors (Redis/DB) never block legitimate users.
 *
 * Usage:
 *   router.get('/sensitive', authenticate, sessionValidationMiddleware, handler);
 *
 * High-risk routes can additionally mount `requireCleanSession` which
 * rejects requests that have accumulated anomaly flags.
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { AuthenticatedRequest } from './auth.middleware';
import { SessionService, SessionRiskLevel } from '../services/session.service';
import { logger } from '../utils/logger.utils';
import { env } from '../config/env';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SessionValidationContext {
  sessionId?: string;
  riskLevel: SessionRiskLevel;
  anomalyScore: number;
  flags: string[];
  /** True when the middleware triggered an automatic session revocation */
  autoRevoked: boolean;
  /** Populated if session was revoked */
  revokeReason?: string;
  /** True when the request has been validated as clean (no flags) */
  clean: boolean;
}

// Extend Express Request type
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      sessionValidation?: SessionValidationContext;
    }
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

const REFRESH_COOKIE = env.REFRESH_TOKEN_COOKIE || 'mm_refresh';

/** Debounce: skip expensive validation if the same session was checked within this window */
const DEBOUNCE_MS = 2 * 60 * 1000; // 2 minutes

/** Risk level above which `requireCleanSession` will reject requests */
const CLEAN_SESSION_MAX_RISK: SessionRiskLevel = 'low';

// In-process debounce map: tokenHash -> last check timestamp
const validationDebounce = new Map<string, number>();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = String(forwarded).split(',')[0].trim();
    return first || null;
  }
  return (req as any).ip ?? req.socket?.remoteAddress ?? null;
}

function extractRefreshToken(req: Request): string | null {
  const header = req.headers['x-refresh-token'] as string | undefined;
  if (header) return header;
  if (req.cookies?.[REFRESH_COOKIE]) return String(req.cookies[REFRESH_COOKIE]);
  if (req.signedCookies?.[REFRESH_COOKIE])
    return String(req.signedCookies[REFRESH_COOKIE]);
  const auth = req.headers.authorization as string | undefined;
  if (auth?.startsWith('Refresh ')) return auth.slice(8).trim();
  return null;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * Main session-validation middleware.
 *
 * Validates the IP address and User-Agent against the stored session
 * fingerprint.  On hijacking indicators, the session is revoked and the
 * request is terminated with 401.
 */
export const sessionValidationMiddleware = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  if (!req.user?.userId) return next();

  const refreshToken = extractRefreshToken(req);
  if (!refreshToken) {
    // Access-token-only request — nothing to fingerprint against
    req.sessionValidation = {
      riskLevel: 'low',
      anomalyScore: 0,
      flags: [],
      autoRevoked: false,
      clean: true,
    };
    return next();
  }

  const tokenHash = hashToken(refreshToken);

  // Debounce: skip repeated validation within the window
  const now = Date.now();
  const lastChecked = validationDebounce.get(tokenHash) ?? 0;
  if (now - lastChecked < DEBOUNCE_MS) {
    // Use whatever context is already on the request, or a safe default
    if (!req.sessionValidation) {
      req.sessionValidation = {
        riskLevel: 'low',
        anomalyScore: 0,
        flags: [],
        autoRevoked: false,
        clean: true,
      };
    }
    return next();
  }
  validationDebounce.set(tokenHash, now);

  try {
    const ipAddress = extractIp(req);
    const userAgent = (req.headers['user-agent'] as string) || null;
    const platform =
      (req.headers['sec-ch-ua-platform'] as string) ||
      (req.headers['x-platform'] as string) ||
      null;

    const result = await SessionService.validateSession({
      tokenHash,
      ipAddress,
      userAgent,
      platform,
      country: null, // geo enrichment done separately if needed
    });

    req.sessionValidation = {
      sessionId: result.session?.id,
      riskLevel: result.riskLevel,
      anomalyScore: result.anomalyScore,
      flags: result.flags as string[],
      autoRevoked: result.autoRevoked,
      revokeReason: result.revokeReason,
      clean: result.flags.length === 0,
    };

    if (result.autoRevoked) {
      // Clear refresh token cookie
      res.clearCookie(REFRESH_COOKIE, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'lax',
      });

      logger.warn('sessionValidationMiddleware: session auto-revoked', {
        userId: req.user.userId,
        reason: result.revokeReason,
        flags: result.flags,
        ip: ipAddress,
      });

      res.status(401).json({
        success: false,
        error: result.revokeReason || 'Session terminated for security reasons.',
        errorCode: 'SESSION_HIJACK_DETECTED',
      });
      return;
    }

    if (result.riskLevel === 'high' || result.riskLevel === 'critical') {
      logger.warn('sessionValidationMiddleware: high-risk session proceeding', {
        userId: req.user.userId,
        riskLevel: result.riskLevel,
        anomalyScore: result.anomalyScore,
        flags: result.flags,
      });
    }

    return next();
  } catch (err: any) {
    // Fail-open: errors must not block legitimate users
    logger.error('sessionValidationMiddleware: unexpected error', {
      error: err.message,
      userId: req.user?.userId,
    });
    req.sessionValidation = {
      riskLevel: 'low',
      anomalyScore: 0,
      flags: [],
      autoRevoked: false,
      clean: true,
    };
    return next();
  }
};

// ─── Guard middlewares ────────────────────────────────────────────────────────

/**
 * Mount on high-risk routes to reject requests from sessions that have
 * accumulated any anomaly flags.  Should follow `sessionValidationMiddleware`.
 *
 * Example:
 *   router.post('/account/delete', authenticate, sessionValidationMiddleware, requireCleanSession, handler);
 */
export const requireCleanSession = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void => {
  const ctx = req.sessionValidation;
  if (!ctx) return next(); // middleware not mounted → allow through

  if (!ctx.clean || ctx.riskLevel !== CLEAN_SESSION_MAX_RISK) {
    res.status(403).json({
      success: false,
      error:
        'Your session has suspicious activity. Please log out and log in again.',
      errorCode: 'SESSION_RISK_TOO_HIGH',
      riskLevel: ctx.riskLevel,
      flags: ctx.flags,
    });
    return;
  }

  next();
};

/**
 * Convenience: block requests that have IP_ADDRESS_CHANGED or
 * USER_AGENT_CHANGED flags but haven't crossed the auto-revoke threshold yet.
 */
export const blockSuspiciousSessions = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void => {
  const ctx = req.sessionValidation;
  if (!ctx) return next();

  const criticalFlags = ['IP_ADDRESS_CHANGED', 'USER_AGENT_CHANGED', 'IMPOSSIBLE_TRAVEL'];
  const hasCritical = ctx.flags.some((f) => criticalFlags.includes(f));

  if (hasCritical) {
    res.status(401).json({
      success: false,
      error: 'Suspicious session activity detected. Please re-authenticate.',
      errorCode: 'SESSION_SUSPICIOUS_ACTIVITY',
      flags: ctx.flags,
    });
    return;
  }

  next();
};
