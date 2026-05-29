import crypto from 'crypto';
import pool from '../config/database';
import { logger } from '../utils/logger';
import { EmailService } from './email.service';
import { PaginationUtil } from '../utils/pagination.utils';

const SESSION_EXPIRY_DAYS = 30;

export interface UserSession {
  id: string;
  user_id: string;
  device_name: string | null;
  ip_address: string | null;
  user_agent: string | null;
  last_active_at: Date;
  created_at: Date;
  expires_at: Date;
}

/**
 * Parse a User-Agent string into a human-readable device/browser name.
 * Avoids external dependencies by using simple regex matching.
 */
export function parseDeviceName(userAgent: string | null | undefined): string {
  if (!userAgent) return 'Unknown Device';

  // Detect OS
  let os = 'Unknown OS';
  if (/Windows NT 10/.test(userAgent)) os = 'Windows 10';
  else if (/Windows NT 6\.3/.test(userAgent)) os = 'Windows 8.1';
  else if (/Windows NT 6\.1/.test(userAgent)) os = 'Windows 7';
  else if (/Windows/.test(userAgent)) os = 'Windows';
  else if (/iPhone/.test(userAgent)) os = 'iPhone';
  else if (/iPad/.test(userAgent)) os = 'iPad';
  else if (/Android/.test(userAgent)) os = 'Android';
  else if (/Mac OS X/.test(userAgent)) os = 'macOS';
  else if (/Linux/.test(userAgent)) os = 'Linux';

  // Detect browser
  let browser = 'Unknown Browser';
  if (/Edg\//.test(userAgent)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(userAgent)) browser = 'Opera';
  else if (/Chrome\//.test(userAgent)) browser = 'Chrome';
  else if (/Firefox\//.test(userAgent)) browser = 'Firefox';
  else if (/Safari\//.test(userAgent) && !/Chrome/.test(userAgent)) browser = 'Safari';
  else if (/MSIE|Trident/.test(userAgent)) browser = 'Internet Explorer';

  return `${browser} on ${os}`;
}

export const SessionManagerService = {
  /**
   * Create a new session record when a user logs in.
   */
  async createSession(params: {
    userId: string;
    refreshToken: string;
    ipAddress: string | null;
    userAgent: string | null;
    userEmail: string;
  }): Promise<UserSession> {
    const { userId, refreshToken, ipAddress, userAgent, userEmail } = params;
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const deviceName = parseDeviceName(userAgent);
    const expiresAt = new Date(Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    const { rows } = await pool.query<UserSession>(
      `INSERT INTO user_sessions (user_id, token_hash, device_name, ip_address, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [userId, tokenHash, deviceName, ipAddress, userAgent, expiresAt],
    );

    // Fire-and-forget: send new session email alert
    this.sendNewSessionAlert({ userEmail, deviceName, ipAddress, createdAt: rows[0].created_at }).catch(
      (err) => logger.error('Failed to send new session email alert', { error: err.message }),
    );

    return rows[0];
  },

  /**
   * List all active (non-revoked, non-expired) sessions for a user with cursor pagination.
   */
  async listSessions(userId: string, filters: { cursor?: string; limit?: number }): Promise<{ sessions: UserSession[]; next_cursor: string | null; has_more: boolean; total: number }> {
    const limit = filters.limit ?? 20;

    const conditions: string[] = ['user_id = $1', 'revoked_at IS NULL', 'expires_at > NOW()'];
    const params: unknown[] = [userId];
    let idx = 2;

    if (filters.cursor) {
      const decoded = PaginationUtil.decodeCursor(filters.cursor);
      if (decoded) {
        // sessions are sorted by last_active_at DESC
        conditions.push(`(last_active_at, id) < ($${idx}, $${idx + 1})`);
        params.push(decoded.created_at, decoded.id);
        idx += 2;
      }
    }

    const [{ rows }, { rows: countRows }] = await Promise.all([
      pool.query<UserSession>(
        `SELECT id, user_id, device_name, ip_address, user_agent, last_active_at, created_at, expires_at
         FROM user_sessions
         WHERE ${conditions.join(' AND ')}
         ORDER BY last_active_at DESC, id DESC
         LIMIT $${idx}`,
        [...params, limit + 1],
      ),
      pool.query(`SELECT COUNT(*) FROM user_sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()`, [userId]),
    ]);

    const has_more = rows.length > limit;
    const data = has_more ? rows.slice(0, limit) : rows;

    const lastItem = data[data.length - 1];
    const next_cursor = has_more && lastItem ? PaginationUtil.encodeCursor({ id: lastItem.id, created_at: lastItem.last_active_at.toISOString() }) : null;

    return {
      sessions: data,
      next_cursor,
      has_more,
      total: parseInt(countRows[0].count, 10),
    };
  },

  /**
   * Revoke a specific session by ID (must belong to the user).
   */
  async revokeSession(sessionId: string, userId: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      `UPDATE user_sessions
       SET revoked_at = NOW()
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [sessionId, userId],
    );
    return (rowCount ?? 0) > 0;
  },

  /**
   * Revoke all sessions for a user except the current one.
   */
  async revokeAllSessions(userId: string, currentRefreshToken: string): Promise<number> {
    const currentTokenHash = crypto.createHash('sha256').update(currentRefreshToken).digest('hex');

    const { rowCount } = await pool.query(
      `UPDATE user_sessions
       SET revoked_at = NOW()
       WHERE user_id = $1
         AND token_hash != $2
         AND revoked_at IS NULL`,
      [userId, currentTokenHash],
    );
    return rowCount ?? 0;
  },

  /**
   * Update last_active_at for a session, debounced to once per minute.
   * Looks up the session by token hash.
   */
  async touchSession(refreshToken: string): Promise<void> {
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

    await pool.query(
      `UPDATE user_sessions
       SET last_active_at = NOW()
       WHERE token_hash = $1
         AND revoked_at IS NULL
         AND expires_at > NOW()
         AND last_active_at < NOW() - INTERVAL '1 minute'`,
      [tokenHash],
    );
  },

  /**
   * Update last_active_at by user_id and session_id (used in middleware when we have the session id).
   */
  async touchSessionById(sessionId: string): Promise<void> {
    await pool.query(
      `UPDATE user_sessions
       SET last_active_at = NOW()
       WHERE id = $1
         AND revoked_at IS NULL
         AND expires_at > NOW()
         AND last_active_at < NOW() - INTERVAL '1 minute'`,
      [sessionId],
    );
  },

  /**
   * Auto-expire sessions inactive for 30 days (called by a scheduled job or on demand).
   */
  async expireInactiveSessions(): Promise<number> {
    const { rowCount } = await pool.query(
      `UPDATE user_sessions
       SET revoked_at = NOW()
       WHERE revoked_at IS NULL
         AND last_active_at < NOW() - INTERVAL '30 days'`,
    );
    return rowCount ?? 0;
  },

  /**
   * Revoke a session by its token hash (used during logout).
   */
  async revokeSessionByToken(refreshToken: string): Promise<void> {
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    await pool.query(
      `UPDATE user_sessions SET revoked_at = NOW() WHERE token_hash = $1`,
      [tokenHash],
    );
  },

  /**
   * Send an email alert when a new session is created.
   */
  async sendNewSessionAlert(params: {
    userEmail: string;
    deviceName: string;
    ipAddress: string | null;
    createdAt: Date;
  }): Promise<void> {
    const emailService = new EmailService();
    const { userEmail, deviceName, ipAddress, createdAt } = params;

    await emailService.sendEmail({
      to: [userEmail],
      subject: 'New login to your account',
      htmlContent: `
        <p>A new session was started on your account.</p>
        <ul>
          <li><strong>Device:</strong> ${deviceName}</li>
          <li><strong>IP Address:</strong> ${ipAddress ?? 'Unknown'}</li>
          <li><strong>Time:</strong> ${createdAt.toUTCString()}</li>
        </ul>
        <p>If this wasn't you, please revoke the session immediately from your account settings.</p>
      `,
      textContent: `A new session was started on your account.\nDevice: ${deviceName}\nIP: ${ipAddress ?? 'Unknown'}\nTime: ${createdAt.toUTCString()}\n\nIf this wasn't you, revoke the session from your account settings.`,
    });
  },
};
