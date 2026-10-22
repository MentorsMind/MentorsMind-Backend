import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { AuthenticatedRequest } from './auth.middleware';
import { SessionManagerService } from '../services/sessionManager.service';
import { DeviceFingerprintService } from '../services/device-fingerprint.service';
import { env } from '../config/env';
import { logger } from '../utils/logger.utils';
import { extractIpAddress } from '../services/auditLog.service';

/**
 * Session security middleware runs after the auth middleware. On each
 * authenticated request it:
 *   1. Extracts refresh token / session id from a per-request derived id
 *   2. Runs `updateSessionFromRequest` to catch hijack / UA mismatch
 *      or mid-session geo jumps.
 *   3. Optionally triggers step-up MFA if risk exceeds threshold.
 *   4. Attaches `sessionId`, `riskLevel`, `sessionTrusted` to req.user.
 *
 * The middleware is "fail-open" on errors so it never blocks users due
 * to internal failures (they get logged, though).
 */

const REFRESH_TOKEN_COOKIE = env.REFRESH_TOKEN_COOKIE || 'mm_refresh';
const MFA_STEPUP_THRESHOLD = (() => {
  const n = parseInt(env.SESSION_MFA_STEPUP_THRESHOLD || '0', 10);
  return n > 0 ? n : 0; // 0 = disabled
})();
const DEBOUNCE_MS = 2 * 60 * 1000; // 2 minutes between expensive per-request checks
const debounce = new Map<string, number>();

export interface SessionSecurityContext {
  sessionId?: string;
  sessionRiskLevel?: 'low' | 'medium' | 'high' | 'critical';
  sessionAutoRevoked?: boolean;
  sessionRevokeReason?: string;
  sessionTrusted?: boolean;
  /** If true, the request was flagged and client should perform step-up MFA */
  requireStepUpMfa?: boolean;
}

declare global {
  namespace Express {
    interface Request {
      sessionSecurity?: SessionSecurityContext;
    }
  }
}

function getRefreshToken(req: Request): string | null {
  const header = (req.headers['x-refresh-token'] as string) || '';
  if (header) return header;
  if (req.cookies?.[REFRESH_TOKEN_COOKIE]) return String(req.cookies[REFRESH_TOKEN_COOKIE]);
  if (req.signedCookies?.[REFRESH_TOKEN_COOKIE]) return String(req.signedCookies[REFRESH_TOKEN_COOKIE]);
  const auth = (req.headers.authorization as string) || '';
  if (auth.startsWith('Refresh ')) return auth.slice(8).trim();
  return null;
}

export const sessionSecurityMiddleware = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  // Skip if no authenticated user
  if (!req.user?.userId) return next();
  const userId = req.user.userId;

  // Skip non-sensitive read-only endpoints (configurable via env)
  const skipPatterns = env.SESSION_SECURITY_SKIP_PATHS?.split(',') || [];
  if (skipPatterns.some((p) => p && req.path.startsWith(p.trim()))) return next();

  try {
    // 1. Derive sessionId. Prefer token hash derived from any refresh token we
    //    can access; if unavailable, fall back to a short-term fingerprint key.
    const refreshToken = getRefreshToken(req);
    const tokenHash = refreshToken
      ? crypto.createHash('sha256').update(refreshToken).digest('hex')
      : null;
    const ip = extractIpAddress(req);
    const ua = req.headers['user-agent'] || null;

    if (tokenHash) {
      // Cheap touch first
      await SessionManagerService.touchSession(refreshToken!);

      // Debounce the expensive fingerprint/geo re-check
      const debKey = `sesssec|${tokenHash.slice(0, 32)}`;
      const last = debounce.get(debKey) ?? 0;
      const now = Date.now();
      if (now - last > DEBOUNCE_MS) {
        debounce.set(debKey, now);
        const found = await SessionManagerService.findSessionByToken(tokenHash);
        if (found) {
          const r = await SessionManagerService.updateSessionFromRequest({
            sessionId: found.id,
            req,
            ipAddress: ip,
            userAgent: ua,
          });
          if (r) {
            req.sessionSecurity = {
              sessionId: found.id,
              sessionRiskLevel: r.riskLevel,
              sessionAutoRevoked: r.autoRevoked,
              sessionRevokeReason: r.reason,
              sessionTrusted: found.is_trusted,
            };
            if (r.autoRevoked) {
              // Clear cookies and respond 401 so user re-authenticates
              if (req.cookies?.[REFRESH_TOKEN_COOKIE]) {
                res.clearCookie(REFRESH_TOKEN_COOKIE, {
                  httpOnly: true,
                  secure: env.NODE_ENV === 'production',
                  sameSite: 'lax',
                });
              }
              AuditLogWrapper(req, 'SESSION_AUTO_REVOKED', found.id, { reason: r.reason });
              res.status(401).json({
                success: false,
                error: r.reason || 'Session terminated for security reasons',
                errorCode: 'SESSION_AUTO_REVOKED',
              });
              return;
            }
            // Step-up MFA request if risk exceeds the threshold and user hasn't already verified
            if (
              MFA_STEPUP_THRESHOLD > 0 &&
              found.anomaly_score >= MFA_STEPUP_THRESHOLD &&
              !req.user.mfaVerified
            ) {
              req.sessionSecurity.requireStepUpMfa = true;
              AuditLogWrapper(req, 'SESSION_STEPUP_MFA_REQUIRED', found.id, {
                score: found.anomaly_score,
                threshold: MFA_STEPUP_THRESHOLD,
              });
            }
          }
        }
      }
    } else {
      // Access-token-only path. We still compute an ephemeral fingerprint just
      // to have some context attached, but don't update the DB.
      const components = DeviceFingerprintService.extractComponents(req);
      const fp = DeviceFingerprintService.generate(req, components);
      req.sessionSecurity = {
        sessionRiskLevel: 'low',
        sessionTrusted: false,
      };
      // Ensure we don't log the full HMAC for privacy
      void fp;
    }

    return next();
  } catch (err: any) {
    logger.error('sessionSecurityMiddleware error', { error: err.message });
    return next(); // fail-open
  }
};

// ── small local helper to avoid circular import risk on logger ──────────────

function AuditLogWrapper(req: Request, action: string, resourceId: string, metadata: Record<string, any>) {
  import('../services/auditLog.service')
    .then(({ AuditLogService }) =>
      AuditLogService.log({
        userId: (req as AuthenticatedRequest).user?.userId || null,
        action,
        resourceType: 'user_session',
        resourceId,
        ipAddress: extractIpAddress(req),
        userAgent: req.headers['user-agent'] || null,
        metadata,
      }).catch(() => {}),
    )
    .catch(() => {});
}

/**
 * Convenience middleware: require step-up MFA to have been completed before
 * executing high-risk handlers (password change, MFA disable, payment, etc.).
 *
 * Mount after `sessionSecurityMiddleware` on specific routes, e.g.:
 *   router.post('/mfa/disable', authenticate, sessionSecurityMiddleware, requireStepUpMfa, mfaCtrl.disable);
 */
export const requireStepUpMfa = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const risk = req.sessionSecurity?.sessionRiskLevel || 'low';
  const need =
    req.sessionSecurity?.requireStepUpMfa ||
    risk === 'high' ||
    risk === 'critical';
  if (need && !req.user?.mfaVerified) {
    res.status(403).json({
      success: false,
      error: 'Additional verification required. Please complete step-up MFA.',
      errorCode: 'STEP_UP_MFA_REQUIRED',
    });
    return;
  }
  next();
};
