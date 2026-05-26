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
      throw new Error("Email is already registered.");
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
      INSERT INTO users (email, password_hash, first_name, last_name, role, notification_preferences)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, role
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

    const tokens = await TokenService.issueTokens(user.id, email, user.role);
    return { ...tokens, userId: user.id };
  },

  async login(input: LoginInput, ipAddress?: string | null, userAgent?: string | null): Promise<any> {
    const { email, password } = input;

    const query = `
      SELECT id, role, password_hash, mfa_enabled 
      FROM users 
      WHERE email = $1 AND status = 'active' AND deleted_at IS NULL
    `;
    const { rows } = await pool.query(query, [email]);

    if (rows.length === 0) {
      throw new Error('Invalid email or password.');
    }

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      throw new Error('Invalid email or password.');
    }

    if (user.mfa_enabled) {
      const mfaToken = jwt.sign(
        { sub: user.id, mfaPending: true },
        JWT_SECRET,
        { expiresIn: '5m' }
      );
      return { mfaRequired: true, mfaToken, userId: user.id };
    }

    const fingerprint = userAgent ? `${ipAddress}:${userAgent}` : undefined;
    const tokens = await TokenService.issueTokens(user.id, email, user.role, fingerprint, {
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
      throw new Error('Invalid or expired reset token.');
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
};
