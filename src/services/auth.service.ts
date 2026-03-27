// @ts-nocheck
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import pool from '../config/database';
import { RegisterInput, LoginInput, ResetPasswordInput } from '../validators/auth.validator';
import { UserRecord } from './users.service';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'fallback_refresh_secret';
const ACCESS_TOKEN_EXPIRED_IN = '15m';
const REFRESH_TOKEN_EXPIRED_IN = '7d';

export interface AuthTokens {
    accessToken: string;
    refreshToken: string;
}

export interface AuthUserRecord extends UserRecord {
    password_hash: string;
    refresh_token: string | null;
    reset_token: string | null;
    reset_token_expires: Date | null;
}

export const AuthService = {
    /**
     * Register a new user
     */
    async register(input: RegisterInput): Promise<AuthTokens & { userId: string }> {
        const { email, password, firstName, lastName, role } = input;

        // Check if email already exists
        const checkQuery = `SELECT id FROM users WHERE email = $1`;
        const checkResult = await pool.query(checkQuery, [email]);
        if (checkResult.rows.length > 0) {
            throw new Error('Email is already registered.');
        }

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        const insertQuery = `
      INSERT INTO users (email, password_hash, first_name, last_name, role)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, role
    `;
        const { rows } = await pool.query(insertQuery, [email, passwordHash, firstName, lastName, role]);
        const user = rows[0];

        const tokens = await this.generateTokens(user.id, user.role);
        return { ...tokens, userId: user.id };
    },

    /**
     * Login an existing user
     */
    async login(input: LoginInput): Promise<{ tokens: AuthTokens; userId: string; role: string }> {
        const { email, password } = input;

        const query = `
      SELECT id, role, password_hash 
      FROM users 
      WHERE email = $1 AND is_active = true
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

        const tokens = await this.generateTokens(user.id, user.role);
        return { tokens, userId: user.id, role: user.role };
    },

    /**
     * Refresh the access and refresh tokens
     */
    async refresh(refreshToken: string): Promise<AuthTokens> {
        try {
            const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET) as { sub: string; role: string };
            const userId = decoded.sub;

            // Ensure the token matches what is in DB (token rotation logic)
            const query = `SELECT refresh_token, role FROM users WHERE id = $1 AND is_active = true`;
            const { rows } = await pool.query(query, [userId]);

            if (rows.length === 0 || rows[0].refresh_token !== refreshToken) {
                // Token reuse detected or invalid user
                throw new Error('Invalid refresh token.');
            }

            return this.generateTokens(userId, rows[0].role);
        } catch {
            throw new Error('Invalid or expired refresh token.');
        }
    },

    /**
     * Logout user by clearing their refresh token
     */
    async logout(userId: string): Promise<void> {
        const query = `UPDATE users SET refresh_token = NULL WHERE id = $1`;
        await pool.query(query, [userId]);
    },

    /**
     * Handle forgot password
     */
    async forgotPassword(email: string): Promise<string> {
        const query = `SELECT id FROM users WHERE email = $1 AND is_active = true`;
        const { rows } = await pool.query(query, [email]);

        if (rows.length === 0) {
            // Don't reveal if user exists or not, just return early
            return '';
        }

        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
        const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

        await pool.query(
            `UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3`,
            [resetTokenHash, expires, rows[0].id]
        );

        // Normally we would send an email here
        return resetToken;
    },

    /**
     * Reset password via token
     */
    async resetPassword(input: ResetPasswordInput): Promise<string> {
        const resetTokenHash = crypto.createHash('sha256').update(input.token).digest('hex');

        const query = `
      SELECT id FROM users 
      WHERE reset_token = $1 AND reset_token_expires > NOW() AND is_active = true
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
        
        return userId;
    },

    /**
     * Generate access and refresh tokens, and save refresh token to DB
     */
    async generateTokens(userId: string, role: string): Promise<AuthTokens> {
        const accessToken = jwt.sign({ sub: userId, role }, JWT_SECRET, {
            expiresIn: ACCESS_TOKEN_EXPIRED_IN,
        });

        const refreshToken = jwt.sign({ sub: userId, role }, JWT_REFRESH_SECRET, {
            expiresIn: REFRESH_TOKEN_EXPIRED_IN,
        });

        // Save refresh token to DB (basic token rotation implementation)
        await pool.query(
            `UPDATE users SET refresh_token = $1 WHERE id = $2`,
            [refreshToken, userId]
        );

        return { accessToken, refreshToken };
    }
};
