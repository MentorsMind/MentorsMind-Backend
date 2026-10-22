/**
 * ImpersonationService
 *
 * Allows admins to temporarily act as another user for debugging purposes.
 * Every impersonation start/end is logged to the audit trail (issue #750).
 *
 * Design decisions:
 *  - Impersonation tokens are SHORT-LIVED (15 minutes, matching access token TTL).
 *  - Tokens carry `isImpersonation: true` and `impersonatedBy: adminId` so any
 *    handler can detect and restrict sensitive operations (e.g. payments).
 *  - Tokens cannot be refreshed — when they expire the admin must start a new
 *    session, creating another audit entry.
 *  - The DB session row acts as a revocation list; middleware checks it.
 */

import pool from '../config/database';
import { JwtUtils } from '../utils/jwt.utils';
import { AuditLogService, extractIpAddress } from './auditLog.service';
import { Request } from 'express';

/** How long an impersonation token lives (must be ≤ access token TTL). */
const IMPERSONATION_TTL_MINUTES = 15;

export interface ImpersonationSession {
  id: string;
  admin_id: string;
  target_user_id: string;
  reason: string;
  started_at: Date;
  expires_at: Date;
  ended_at: Date | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date;
}

export interface StartImpersonationResult {
  token: string;
  sessionId: string;
  expiresAt: Date;
  targetUser: {
    id: string;
    email: string;
    role: string;
    firstName: string;
    lastName: string;
  };
}

export const ImpersonationService = {
  /**
   * Start an impersonation session.
   *
   * Validates that:
   *  - The target user exists and is not deleted.
   *  - Admins cannot impersonate other admins (prevents privilege escalation).
   *
   * Returns a short-lived JWT that looks like a normal user token but carries
   * `isImpersonation: true` and `impersonatedBy` fields in its payload.
   */
  async startImpersonation(
    adminId: string,
    targetUserId: string,
    reason: string,
    ipAddress?: string | null,
    userAgent?: string | null,
  ): Promise<StartImpersonationResult> {
    // 1. Fetch target user
    const { rows: userRows } = await pool.query<{
      id: string;
      email: string;
      role: string;
      first_name: string;
      last_name: string;
      user_tier: string;
      deleted_at: Date | null;
    }>(
      `SELECT id, email, role, first_name, last_name, user_tier, deleted_at
       FROM users WHERE id = $1`,
      [targetUserId],
    );

    if (userRows.length === 0) {
      throw Object.assign(new Error('Target user not found'), { status: 404 });
    }

    const target = userRows[0];

    if (target.deleted_at) {
      throw Object.assign(new Error('Cannot impersonate a deleted user'), { status: 400 });
    }

    if (target.role === 'admin') {
      throw Object.assign(
        new Error('Impersonating another admin is not permitted'),
        { status: 403 },
      );
    }

    // 2. Compute expiry
    const expiresAt = new Date(Date.now() + IMPERSONATION_TTL_MINUTES * 60 * 1000);

    // 3. Insert session record
    const { rows: sessionRows } = await pool.query<ImpersonationSession>(
      `INSERT INTO admin_impersonation_sessions
         (admin_id, target_user_id, reason, expires_at, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [adminId, targetUserId, reason, expiresAt, ipAddress ?? null, userAgent ?? null],
    );

    const session = sessionRows[0];

    // 4. Issue impersonation JWT
    // We reuse JwtUtils.generateAccessToken but inject extra impersonation claims.
    // The token is signed with the normal JWT secret so existing middleware
    // (RSA or HMAC) can verify it without changes.
    const rawToken = JwtUtils.generateAccessToken({
      userId: target.id,
      email: target.email,
      role: target.role,
      userTier: target.user_tier ?? 'free',
    });

    // Decode the generated token, strip signature, re-sign with extra claims.
    // We cannot inject extra claims into JwtUtils.generateAccessToken directly
    // without changing its signature, so we use jsonwebtoken directly here.
    const jwt = await import('jsonwebtoken');
    const config = (await import('../config')).default;

    const decoded = jwt.default.verify(rawToken, config.jwt.secret) as Record<string, unknown>;

    const impersonationToken = jwt.default.sign(
      {
        ...decoded,
        isImpersonation: true,
        impersonatedBy: adminId,
        impersonationSessionId: session.id,
        // Override iat/exp — jwt.sign will set fresh values
        iat: undefined,
        exp: undefined,
      },
      config.jwt.secret,
      {
        expiresIn: `${IMPERSONATION_TTL_MINUTES}m`,
        issuer: 'mentorsmind-api',
        audience: 'mentorsmind-client',
      },
    );

    // 5. Audit log
    await AuditLogService.log({
      userId: adminId,
      action: 'ADMIN_IMPERSONATION_STARTED',
      resourceType: 'user',
      resourceId: targetUserId,
      newValue: {
        sessionId: session.id,
        reason,
        expiresAt: expiresAt.toISOString(),
      },
      ipAddress: ipAddress ?? null,
      userAgent: userAgent ?? null,
    });

    return {
      token: impersonationToken,
      sessionId: session.id,
      expiresAt,
      targetUser: {
        id: target.id,
        email: target.email,
        role: target.role,
        firstName: target.first_name,
        lastName: target.last_name,
      },
    };
  },

  /**
   * Explicitly end an impersonation session before it expires naturally.
   * This records an audit entry with the elapsed duration.
   */
  async endImpersonation(
    sessionId: string,
    adminId: string,
    ipAddress?: string | null,
    userAgent?: string | null,
  ): Promise<ImpersonationSession> {
    const { rows } = await pool.query<ImpersonationSession>(
      `UPDATE admin_impersonation_sessions
       SET ended_at = NOW()
       WHERE id = $1 AND admin_id = $2 AND ended_at IS NULL
       RETURNING *`,
      [sessionId, adminId],
    );

    if (rows.length === 0) {
      throw Object.assign(
        new Error('Impersonation session not found or already ended'),
        { status: 404 },
      );
    }

    const session = rows[0];

    await AuditLogService.log({
      userId: adminId,
      action: 'ADMIN_IMPERSONATION_ENDED',
      resourceType: 'user',
      resourceId: session.target_user_id,
      newValue: {
        sessionId,
        endedAt: session.ended_at?.toISOString(),
      },
      ipAddress: ipAddress ?? null,
      userAgent: userAgent ?? null,
    });

    return session;
  },

  /**
   * List all active (not ended, not expired) impersonation sessions for an admin.
   */
  async getActiveImpersonations(adminId: string): Promise<
    Array<
      ImpersonationSession & {
        target_email: string;
        target_first_name: string;
        target_last_name: string;
        target_role: string;
      }
    >
  > {
    const { rows } = await pool.query(
      `SELECT s.*,
              u.email    AS target_email,
              u.first_name AS target_first_name,
              u.last_name  AS target_last_name,
              u.role       AS target_role
       FROM admin_impersonation_sessions s
       JOIN users u ON u.id = s.target_user_id
       WHERE s.admin_id = $1
         AND s.ended_at IS NULL
         AND s.expires_at > NOW()
       ORDER BY s.started_at DESC`,
      [adminId],
    );

    return rows;
  },

  /**
   * Verify that an impersonation session is still valid (not ended, not expired).
   * Called by auth middleware when it detects an impersonation token.
   */
  async validateSession(sessionId: string): Promise<boolean> {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM admin_impersonation_sessions
       WHERE id = $1
         AND ended_at IS NULL
         AND expires_at > NOW()`,
      [sessionId],
    );
    return rows.length > 0;
  },

  /** Helper: extract IP + UA from Express request */
  extractRequestMeta(req: Request): { ipAddress: string; userAgent: string | null } {
    return {
      ipAddress: extractIpAddress(req),
      userAgent: req.headers['user-agent'] ?? null,
    };
  },
};
