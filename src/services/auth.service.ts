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
      RETURNING id, role, user_tier
    `;
    const { rows } = await pool.query(insertQuery, [
      email,
      passwordHash,
      firstName,
      lastName,
      role,
      JSON.stringify(defaultPreferences),
    ]);
    const user = rows[0];

    const tokens = await TokenService.issueTokens(user.id, email, user.role, user.user_tier);
    return { ...tokens, userId: user.id };
  },

  async login(input: LoginInput, ipAddress?: string | null, userAgent?: string | null, req?: any): Promise<any> {
    const { email, password } = input;

    const query = `
      SELECT id, role, password_hash, mfa_enabled, user_tier 
      FROM users 
      WHERE email = $1 AND deleted_at IS NULL
    `;
    const { rows } = await pool.query(query, [email]);

    if (rows.length === 0) {
      // Log failed attempt
      await this.logAuthAttempt(null, email, false, 'Invalid credentials', ipAddress, userAgent);
      throw new Error('Invalid email or password.');
    }

    const user = rows[0];

    // Banned users receive a specific error and cannot log in at all
    if (user.status === 'banned') {
      throw createError(ErrorCode.AUTH_ACCOUNT_BANNED, 403);
    }

    // Suspended users cannot log in
    if (user.status === 'suspended') {
      throw createError(ErrorCode.AUTH_ACCOUNT_SUSPENDED, 403);
    }

    // Any other non-active status (inactive, pending_verification)
    if (user.status !== 'active') {
      throw createError(ErrorCode.AUTH_INVALID_CREDENTIALS, 401);
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      throw createError(ErrorCode.AUTH_INVALID_CREDENTIALS, 401);
    }

    // Perform adaptive authentication if request object is available
    if (req) {
      try {
        const { AdaptiveAuthService } = await import('./adaptive-auth.service');
        const adaptiveResult = await AdaptiveAuthService.authenticateAdaptive(req, {
          userId: user.id,
          email,
          isLoginAttempt: true
        });

        if (adaptiveResult.decision === 'block') {
          await this.logAuthAttempt(user.id, email, false, 'Blocked by adaptive auth', ipAddress, userAgent, adaptiveResult.riskScore);
          throw new Error('Login blocked due to security policy. Please try again later or contact support.');
        }

        if (adaptiveResult.decision === 'challenge') {
          await this.logAuthAttempt(user.id, email, false, 'Additional challenges required', ipAddress, userAgent, adaptiveResult.riskScore);
          return {
            challengesRequired: true,
            challenges: adaptiveResult.challenges,
            sessionId: adaptiveResult.sessionId,
            riskLevel: adaptiveResult.riskLevel,
            userId: user.id
          };
        }
      } catch (error) {
        // Don't fail login if adaptive auth service is unavailable
        logger.warn('Adaptive auth service unavailable during login', { userId: user.id, error });
      }
    }

    if (user.mfa_enabled) {
      const mfaToken = jwt.sign(
        { sub: user.id, mfaPending: true },
        JWT_SECRET,
        { expiresIn: '5m' }
      );
      await this.logAuthAttempt(user.id, email, false, 'MFA required', ipAddress, userAgent);
      return { mfaRequired: true, mfaToken, userId: user.id };
    }

    const fingerprint = userAgent ? `${ipAddress}:${userAgent}` : undefined;
    const tokens = await TokenService.issueTokens(user.id, email, user.role, user.user_tier, fingerprint, {
      deviceName: userAgent ?? undefined,
      ipAddress: ipAddress ?? undefined,
    });

    const { SessionManagerService } = await import('./sessionManager.service');
    await SessionManagerService.createSession({
      userId: user.id,
      refreshToken: tokens.refreshToken,
      ipAddress: ipAddress ?? null,
      userAgent: userAgent ?? null,
      userEmail: email,
    }).catch(() => { });

    // Log successful authentication
    await this.logAuthAttempt(user.id, email, true, 'Login successful', ipAddress, userAgent);

    return { tokens, userId: user.id, role: user.role };
  },

  async refresh(refreshToken: string, fingerprint?: string): Promise<AuthTokens> {
    return TokenService.rotateRefreshToken(refreshToken, fingerprint);
  },

  async logout(userId: string, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      await TokenService.revokeRefreshToken(refreshToken);

      const { SessionManagerService } = await import('./sessionManager.service');
      await SessionManagerService.revokeSessionByToken(refreshToken).catch(() => { });
    } else {
      await TokenService.revokeAllUserSessions(userId);
    }
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
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(input.newPassword, salt);

    await pool.query(
      `UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2`,
      [passwordHash, userId]
    );

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
      console.error('Failed to log auth attempt:', error);
    }
  }
};
