import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { logger } from '../utils/logger';

const JWT_SECRET = env.JWT_SECRET;
const LAST_ACTIVE_DEBOUNCE_MS = 60 * 1000; // 1 minute

// In-memory debounce map: userId -> last update timestamp
const lastActiveDebounce = new Map<string, number>();

export interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    role: string;
  };
}

export const authenticate = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        error: 'Authentication required. Please provide a valid Bearer token.',
      });
      return;
    }

    const token = authHeader.split(' ')[1];

    // Decode header to extract kid for RSA key lookup
    const header = jwt.decode(token, { complete: true })?.header as { kid?: string; alg?: string } | null;

    let decoded: { sub: string; role: string; iat?: number };

    if (header?.kid && header?.alg === 'RS256') {
      // ── RSA-256 path: look up the public key by kid ──
      const { JwksService } = await import('../services/jwks.service');
      const keyPair = await JwksService.getKeyById(header.kid);

      if (!keyPair) {
        res.status(401).json({ success: false, error: 'Unknown signing key.' });
        return;
      }

      // Reject tokens signed with the previous key if it's past the 24-hour window
      const current = await JwksService.getCurrentKey();
      if (keyPair.kid !== current?.kid && !JwksService.isPreviousKeyValid(keyPair)) {
        res.status(401).json({ success: false, error: 'Signing key has expired. Please log in again.' });
        return;
      }

      decoded = jwt.verify(token, keyPair.publicKeyPem, { algorithms: ['RS256'] }) as { sub: string; role: string };
    } else {
      // ── HMAC fallback: handles tokens issued before RSA migration ──
      decoded = jwt.verify(token, JWT_SECRET) as { sub: string; role: string };
    }

    const userId = decoded.sub;
    const issuedAtMs =
      typeof decoded.iat === 'number' ? decoded.iat * 1000 : Date.now();
    const isRevoked = await isTokenRevokedForUser(userId, issuedAtMs);
    if (isRevoked) {
      res.status(401).json({
        success: false,
        error: 'Token has been revoked. Please log in again.',
      });
      return;
    }

    req.user = {
      id: userId,
      userId,
      role: decoded.role,
    } as any;

    // Debounced last_active_at update — max once per minute per user
    const now = Date.now();
    const lastUpdate = lastActiveDebounce.get(userId) ?? 0;

    if (now - lastUpdate >= LAST_ACTIVE_DEBOUNCE_MS) {
      lastActiveDebounce.set(userId, now);
      pool_updateLastActive(userId).catch((err: any) =>
        logger.error('Failed to update session last_active_at', { userId, error: err.message }),
      );
    }

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({ success: false, error: 'Token expired.' });
      return;
    }
    res.status(401).json({ success: false, error: 'Invalid token.' });
  }
};

/**
 * Update last_active_at for all active sessions belonging to a user.
 */
async function pool_updateLastActive(userId: string): Promise<void> {
  const pool = (await import('../config/database')).default;
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

async function isTokenRevokedForUser(
  userId: string,
  issuedAtMs: number,
): Promise<boolean> {
  const pool = (await import('../config/database')).default;
  const { rows } = await pool.query(
    `SELECT token_invalid_before, deletion_completed_at
       FROM users
      WHERE id = $1`,
    [userId],
  );

  const user = rows[0];
  if (!user) {
    return true;
  }

  if (user.deletion_completed_at) {
    return true;
  }

  return (
    user.token_invalid_before instanceof Date &&
    issuedAtMs <= user.token_invalid_before.getTime()
  );
}

export const requireRole = (roles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Insufficient permissions.',
      });
    }
    next();
  };
};
