import bcrypt from "bcryptjs";
import { env } from "../config/env";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import pool from "../config/database";
import {
  RegisterInput,
  LoginInput,
  ResetPasswordInput,
} from "../validators/auth.validator";
import { UserRecord } from "./users.service";
import { TokenService } from "./token.service";
import { createError } from "../middleware/errorHandler";
import { ErrorCode } from "../errors/error-codes";
import { CacheService } from "./cache.service";
import { logger } from "../utils/logger.utils";

const JWT_SECRET = env.JWT_SECRET;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthUserRecord extends UserRecord {
  password_hash: string;
  reset_token: string | null;
  reset_token_expires: Date | null;
}

export const AuthService = {
  async register(
    input: RegisterInput,
  ): Promise<AuthTokens & { userId: string }> {
    const { email, password, firstName, lastName, role } = input;

    const checkQuery = `SELECT id FROM users WHERE email = $1`;
    const checkResult = await pool.query(checkQuery, [email]);
    if (checkResult.rows.length > 0) {
      throw createError(ErrorCode.AUTH_EMAIL_ALREADY_REGISTERED, 409);
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const defaultPreferences = {
      booking_confirmed: { email: true, push: true, in_app: true },
      payment_processed: { email: true, push: true, in_app: true },
      session_reminder: { email: true, push: true, in_app: true },
      dispute_created: { email: true, push: true, in_app: true },
      system_alert: { email: true, push: true, in_app: true },
      meeting_confirmed: { email: true, push: true, in_app: true },
      message_received: { email: true, push: true, in_app: true },
      session_cancelled: { email: true, push: true, in_app: true },
    };

    const insertQuery = `
      INSERT INTO users (email, password_hash, first_name, last_name, role, notification_preferences, user_tier)
      VALUES ($1, $2, $3, $4, $5, $6, 'free')
      ON CONFLICT (email) DO NOTHING
      RETURNING id, role, user_tier
    `;
    try {
      const { rows } = await pool.query(insertQuery, [
        email,
        passwordHash,
        firstName,
        lastName,
        role,
        JSON.stringify(defaultPreferences),
      ]);

      // ON CONFLICT DO NOTHING yields no rows when a concurrent request
      // inserted the same email between our uniqueness check and this insert,
      // so the check-then-insert race is resolved atomically by the database.
      if (rows.length === 0) {
        throw createError(
          ErrorCode.CONFLICT,
          409,
          { message: 'An account with this email already exists' }
        );
      }

      const user = rows[0];

      const tokens = await TokenService.issueTokens(user.id, email, user.role, user.user_tier);
      return { ...tokens, userId: user.id };
    } catch (err: any) {
      // Defensive fallback: if a unique violation on email is still raised
      // (e.g. the conflict target above is not matched), translate it into a
      // user-friendly 409 instead of leaking the raw database error.
      if (err.code === '23505' && err.constraint?.includes('email')) {
        throw createError(
          ErrorCode.CONFLICT,
          409,
          { message: 'An account with this email already exists' }
        );
      }
      throw err;
    }
  },

  /**
   * Verify credentials and return a pre-auth record. The caller is responsible
   * for running adaptive authentication (if applicable) before calling
   * completeLogin(), keeping HTTP-layer concerns out of this service.
   */
  async verifyCredentials(
    input: LoginInput,
    ipAddress?: string | null,
    userAgent?: string | null,
  ): Promise<{ userId: string; email: string; role: string; userTier: string; mfaEnabled: boolean; _hash: string; _plaintext: string }> {
    const { email, password } = input;

    const query = `
      SELECT id, role, status, password_hash, mfa_enabled, user_tier
      FROM users
      WHERE email = $1 AND deleted_at IS NULL
    `;
    const { rows } = await pool.query(query, [email]);

    if (rows.length === 0) {
      await this.logAuthAttempt(null, email, false, 'Invalid credentials', ipAddress, userAgent);
      throw new Error('Invalid email or password.');
    }

    const user = rows[0];

    if (user.status === 'banned') {
      throw createError(ErrorCode.AUTH_ACCOUNT_BANNED, 403);
    }
    if (user.status === 'suspended') {
      throw createError(ErrorCode.AUTH_ACCOUNT_SUSPENDED, 403);
    }
    if (user.status !== 'active') {
      throw createError(ErrorCode.AUTH_INVALID_CREDENTIALS, 401);
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      throw createError(ErrorCode.AUTH_INVALID_CREDENTIALS, 401);
    }

    return {
      userId: user.id,
      email,
      role: user.role,
      userTier: user.user_tier,
      mfaEnabled: user.mfa_enabled,
      _hash: user.password_hash,
      _plaintext: password,
    };
  },

  /**
   * Complete a login after credentials have been verified and adaptive auth
   * (if enabled) has passed. Issues tokens and creates a session.
   */
  async completeLogin(
    userId: string,
    email: string,
    role: string,
    userTier: string,
    passwordHash: string,
    plaintextPassword: string,
    ipAddress?: string | null,
    userAgent?: string | null,
  ): Promise<{ tokens: AuthTokens; userId: string; role: string }> {
    // Enforce PASSWORD_EXPIRY_DAYS policy at login time
    const expiryDays = Number(env.PASSWORD_EXPIRY_DAYS);
    if (expiryDays > 0) {
      const { rows: expiryRows } = await pool.query<{ password_expired: boolean; password_changed_at: Date | null }>(
        `SELECT password_expired, password_changed_at FROM users WHERE id = $1`,
        [userId],
      );
      if (expiryRows.length > 0) {
        const { password_expired, password_changed_at } = expiryRows[0];
        const expiredByFlag = password_expired === true;
        const expiredByAge =
          password_changed_at != null &&
          Date.now() - new Date(password_changed_at).getTime() > expiryDays * 86_400_000;
        if (expiredByFlag || expiredByAge) {
          throw createError(ErrorCode.AUTH_PASSWORD_EXPIRED, 403);
        }
      }
    }

    const fingerprint = userAgent ? `${ipAddress}:${userAgent}` : undefined;
    const tokens = await TokenService.issueTokens(userId, email, role, userTier, fingerprint, {
      deviceName: userAgent ?? undefined,
      ipAddress: ipAddress ?? undefined,
    });

    const { SessionManagerService } = await import('./sessionManager.service');
    await SessionManagerService.createSession({
      userId,
      refreshToken: tokens.refreshToken,
      ipAddress: ipAddress ?? null,
      userAgent: userAgent ?? null,
      userEmail: email,
    }).catch(() => { });

    await this.logAuthAttempt(userId, email, true, 'Login successful', ipAddress, userAgent);

    const currentRounds = Number(env.BCRYPT_ROUNDS);
    if (bcrypt.getRounds(passwordHash) !== currentRounds) {
      setImmediate(async () => {
        try {
          const upgradedHash = await bcrypt.hash(plaintextPassword, currentRounds);
          await pool.query(
            `UPDATE users SET password_hash = $1 WHERE id = $2`,
            [upgradedHash, userId]
          );
        } catch (error) {
          logger.warn('Failed to upgrade password hash after login', { userId, error });
        }
      });
    }

    return { tokens, userId, role };
  },

  async login(input: LoginInput, ipAddress?: string | null, userAgent?: string | null): Promise<any> {
    const pre = await this.verifyCredentials(input, ipAddress, userAgent);

    if (pre.mfaEnabled) {
      const mfaToken = jwt.sign(
        { sub: pre.userId, mfaPending: true },
        JWT_SECRET,
        { expiresIn: '5m' }
      );
      await this.logAuthAttempt(pre.userId, pre.email, false, 'MFA required', ipAddress, userAgent);
      return { mfaRequired: true, mfaToken, userId: pre.userId };
    }

    return this.completeLogin(pre.userId, pre.email, pre.role, pre.userTier, pre._hash, pre._plaintext, ipAddress, userAgent);
  },

  async refresh(refreshToken: string, fingerprint?: string): Promise<AuthTokens> {
    return TokenService.rotateRefreshToken(refreshToken, fingerprint);
  },

  async logout(userId: string, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      await TokenService.revokeRefreshToken(refreshToken);

      const { SessionManagerService } = await import('./sessionManager.service');
      await SessionManagerService.revokeSessionByToken(refreshToken).catch(() => { });
      await TokenService.invalidateRevocationCache(userId);
    } else {
      // revokeAllUserSessions also invalidates the revocation cache
      await TokenService.revokeAllUserSessions(userId);
    }
    await CacheService.invalidatePattern(`token:revoked:${userId}:*`);
  },

  async forgotPassword(email: string): Promise<string> {
    const query = `SELECT id FROM users WHERE email = $1 AND status = 'active' AND deleted_at IS NULL`;
    const { rows } = await pool.query(query, [email]);

    if (rows.length === 0) {
      return '';
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    const expires = new Date(Date.now() + 15 * 60 * 1000);

    await pool.query(
      `UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3`,
      [resetTokenHash, expires, rows[0].id]
    );

    return resetToken;
  },

  async checkPasswordHistory(userId: string, newPassword: string): Promise<void> {
    const historyCount = Number(env.PASSWORD_HISTORY_COUNT);
    if (historyCount <= 0) return;

    const { rows } = await pool.query<{ hash: string }>(
      `SELECT hash FROM password_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, historyCount],
    );

    for (const row of rows) {
      const reused = await bcrypt.compare(newPassword, row.hash);
      if (reused) {
        throw createError('Password has been used recently. Please choose a different password.', 400);
      }
    }
  },

  async recordPasswordHistory(userId: string, passwordHash: string): Promise<void> {
    await pool.query(
      `INSERT INTO password_history (user_id, hash) VALUES ($1, $2)`,
      [userId, passwordHash],
    );
  },

  async resetPassword(input: ResetPasswordInput): Promise<string> {
    const resetTokenHash = crypto.createHash('sha256').update(input.token).digest('hex');

    const query = `
      SELECT id FROM users
      WHERE reset_token = $1 AND reset_token_expires > NOW() AND status = 'active' AND deleted_at IS NULL
    `;
    const { rows } = await pool.query(query, [resetTokenHash]);

    if (rows.length === 0) {
      throw createError(ErrorCode.AUTH_INVALID_RESET_TOKEN, 400);
    }

    const userId = rows[0].id;

    await this.checkPasswordHistory(userId, input.newPassword);

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(input.newPassword, salt);

    await pool.query(
      `UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2`,
      [passwordHash, userId]
    );

    await this.recordPasswordHistory(userId, passwordHash);

    await TokenService.revokeAllUserSessions(userId);

    return userId;
  },

  /**
   * Log authentication attempts for risk analysis
   */
  async logAuthAttempt(
    userId: string | null,
    email: string,
    success: boolean,
    failureReason?: string,
    ipAddress?: string | null,
    userAgent?: string | null,
    riskScore?: number
  ): Promise<void> {
    try {
      await pool.query(`
        INSERT INTO auth_attempts (
          user_id, email, success, failure_reason, ip_address, user_agent, 
          risk_score, authentication_method, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'password', NOW())
      `, [
        userId,
        email,
        success,
        failureReason,
        ipAddress,
        userAgent,
        riskScore
      ]);
    } catch (error) {
      // Don't fail auth if logging fails
      logger.error('Failed to log auth attempt:', error);
    }
  }
};
