// @ts-nocheck
import pool from '../config/database';
import { JwtUtils, TokenPayload, DecodedToken } from '../utils/jwt.utils';
import crypto from 'crypto';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export const TokenService = {
  /**
   * Issue new token pair for a user
   * Implements concurrent session limit
   */
  async issueTokens(
    userId: string,
    email: string,
    role: string,
    fingerprint?: string,
  ): Promise<AuthTokens> {
    const payload: TokenPayload = { userId, email, role };

    // Check concurrent sessions (max 5)
    await this.enforceSessionLimit(userId, 5);

    const accessToken = JwtUtils.generateAccessToken(payload, fingerprint);
    const refreshToken = JwtUtils.generateRefreshToken(payload, fingerprint);
    const tokenHash = JwtUtils.hashToken(refreshToken);
    const familyId = crypto.randomUUID();

    // Store refresh token with a new family ID
    const decoded = JwtUtils.verifyRefreshToken(refreshToken);
    const expiresAt = new Date(decoded.exp * 1000);

    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, family_id, device_fingerprint, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        userId,
        tokenHash,
        familyId,
        fingerprint ? JwtUtils.hashFingerprint(fingerprint) : null,
        expiresAt,
      ],
    );

    return { accessToken, refreshToken };
  },

  /**
   * Rotate refresh token
   * Implements theft detection and automatic logout on reuse
   */
  async rotateRefreshToken(
    oldRefreshToken: string,
    fingerprint?: string,
  ): Promise<AuthTokens> {
    let decoded: DecodedToken;
    try {
      decoded = JwtUtils.verifyRefreshToken(oldRefreshToken);
    } catch (error) {
      throw new Error('Invalid refresh token', { cause: error });
    }

    const oldTokenHash = JwtUtils.hashToken(oldRefreshToken);

    // Find the token in DB
    const { rows } = await pool.query(
      `SELECT * FROM refresh_tokens WHERE token_hash = $1 AND revoked_at IS NULL`,
      [oldTokenHash],
    );

    const tokenRecord = rows[0];

    // THEFT DETECTION: If token not found but it's valid, it might have been reused
    if (!tokenRecord) {
      // Find if this token was already used (replaced_by is not null)
      const { rows: usedRows } = await pool.query(
        `SELECT family_id, user_id FROM refresh_tokens WHERE token_hash = $1`,
        [oldTokenHash],
      );

      if (usedRows.length > 0) {
        // TOKEN REUSE DETECTED! Revoke entire family for security
        const { family_id } = usedRows[0];
        await this.revokeTokenFamily(family_id);
        throw new Error('Suspicious activity detected. All sessions revoked.');
      }
      throw new Error('Refresh token not found or revoked');
    }

    // Verify fingerprint if provided
    if (fingerprint && tokenRecord.device_fingerprint) {
      const hashedFingerprint = JwtUtils.hashFingerprint(fingerprint);
      if (tokenRecord.device_fingerprint !== hashedFingerprint) {
        // Fingerprint mismatch - potential theft
        await this.revokeTokenFamily(tokenRecord.family_id);
        throw new Error('Device mismatch. Session revoked.');
      }
    }

    // Generate new pair
    const payload: TokenPayload = {
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role,
    };

    const newAccessToken = JwtUtils.generateAccessToken(payload, fingerprint);
    const newRefreshToken = JwtUtils.generateRefreshToken(payload, fingerprint);
    const newTokenHash = JwtUtils.hashToken(newRefreshToken);
    const newDecoded = JwtUtils.verifyRefreshToken(newRefreshToken);
    const newExpiresAt = new Date(newDecoded.exp * 1000);

    // Start transaction for rotation
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Create new token in same family
      const { rows: insertRows } = await client.query(
        `INSERT INTO refresh_tokens (user_id, token_hash, family_id, device_fingerprint, expires_at)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [
          decoded.userId,
          newTokenHash,
          tokenRecord.family_id,
          tokenRecord.device_fingerprint,
          newExpiresAt,
        ],
      );

      // Revoke old token and link to new one
      await client.query(
        `UPDATE refresh_tokens SET revoked_at = NOW(), replaced_by = $1 WHERE id = $2`,
        [insertRows[0].id, tokenRecord.id],
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
  },

  /**
   * Blacklist an access token (on logout)
   */
  async blacklistToken(jti: string, expiresAt: number): Promise<void> {
    const expDate = new Date(expiresAt * 1000);
    await pool.query(
      `INSERT INTO token_blacklist (token_jti, expires_at) VALUES ($1, $2)
       ON CONFLICT (token_jti) DO NOTHING`,
      [jti, expDate],
    );
  },

  /**
   * Check if token is blacklisted
   */
  async isTokenBlacklisted(jti: string): Promise<boolean> {
    const { rows } = await pool.query(
      `SELECT 1 FROM token_blacklist WHERE token_jti = $1 AND expires_at > NOW()`,
      [jti],
    );
    return rows.length > 0;
  },

  /**
   * Revoke a refresh token (on logout)
   */
  async revokeRefreshToken(token: string): Promise<void> {
    const hash = JwtUtils.hashToken(token);
    await pool.query(
      `UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1`,
      [hash],
    );
  },

  /**
   * Revoke all tokens in a family
   */
  async revokeTokenFamily(familyId: string): Promise<void> {
    await pool.query(
      `UPDATE refresh_tokens SET revoked_at = NOW() WHERE family_id = $1`,
      [familyId],
    );
  },

  /**
   * Revoke all sessions for a user
   */
  async revokeAllUserSessions(userId: string): Promise<void> {
    await pool.query(
      `UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1`,
      [userId],
    );
  },

  /**
   * Enforce concurrent session limit
   */
  async enforceSessionLimit(userId: string, limit: number): Promise<void> {
    const { rows } = await pool.query(
      `SELECT id FROM refresh_tokens 
       WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
       ORDER BY created_at ASC`,
      [userId],
    );

    if (rows.length >= limit) {
      // Revoke oldest sessions to make room for new one
      const toRevoke = rows.slice(0, rows.length - limit + 1);
      const ids = toRevoke.map((r) => r.id);
      await pool.query(
        `UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = ANY($1)`,
        [ids],
      );
    }
  },
};
