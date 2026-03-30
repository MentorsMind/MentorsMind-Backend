import { Request, Response } from 'express';
import { MfaService } from '../services/mfa.service';
import { UsersService } from '../services/users.service';
import { AuthService } from '../services/auth.service';
import { SessionManagerService } from '../services/sessionManager.service';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import pool from '../config/database';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AuditLogService, extractIpAddress } from '../services/auditLog.service';

export const MfaController = {
  /**
   * Start MFA setup process.
   * Generates a secret and returns a QR code.
   */
  async setup(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const user = await UsersService.findById(userId);
      if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      const secret = MfaService.generateSecret();
      const qrCodeUrl = await MfaService.generateQrCode(user.email, secret);
      const encryptedSecret = MfaService.encryptSecret(secret);

      // Store the secret but don't enable yet
      await pool.query(
        `UPDATE users SET mfa_secret = $1 WHERE id = $2`,
        [encryptedSecret, userId]
      );

      return res.status(200).json({
        success: true,
        data: {
          qrCodeUrl,
          manualEntryKey: secret,
        },
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * Finalize MFA setup by verifying the first token.
   */
  async verifySetup(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      const { token } = req.body;

      if (!userId || !token) {
        return res.status(400).json({ success: false, error: 'User ID and token are required' });
      }

      const { rows } = await pool.query(`SELECT mfa_secret, email FROM users WHERE id = $1`, [userId]);
      if (!rows.length || !rows[0].mfa_secret) {
        return res.status(400).json({ success: false, error: 'MFA setup not initiated' });
      }

      const secret = MfaService.decryptSecret(rows[0].mfa_secret);
      const isValid = await MfaService.verifyToken(token, secret);

      if (!isValid) {
        return res.status(401).json({ success: false, error: 'Invalid TOTP token' });
      }

      // Generate backup codes
      const { plain, hashed } = MfaService.generateBackupCodes();

      // Enable MFA and store hashed backup codes
      await pool.query(
        `UPDATE users SET mfa_enabled = true, mfa_backup_codes = $1 WHERE id = $2`,
        [hashed, userId]
      );

      // Invalidate all other sessions for security
      const tokenHeader = req.headers.authorization;
      const currentRefreshToken = tokenHeader?.startsWith('Bearer ') ? tokenHeader.slice(7) : ''; // Note: this might not be the refresh token, but we need to invalidate all anyway.
      // Actually, SessionManagerService.revokeAllSessions(userId, currentRefreshToken) is best.
      // But we might not have the refresh token here.
      // Let's just revoke all and let the user re-login if needed, or better, keep the current one if we can identify it.
      
      // For simplicity, revoke all sessions. The user will need to log in again.
      await pool.query(`UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = $1`, [userId]);

      await AuditLogService.log({
        userId,
        action: 'MFA_ENABLED',
        resourceType: 'auth',
        resourceId: userId,
        ipAddress: extractIpAddress(req),
        userAgent: req.headers['user-agent'] || null,
      });

      return res.status(200).json({
        success: true,
        message: 'MFA enabled successfully',
        data: {
          backupCodes: plain,
        },
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * Disable MFA.
   */
  async disable(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      const { token } = req.body;

      if (!userId || !token) {
        return res.status(400).json({ success: false, error: 'User ID and token are required' });
      }

      const { rows } = await pool.query(`SELECT mfa_secret, mfa_enabled FROM users WHERE id = $1`, [userId]);
      if (!rows.length || !rows[0].mfa_enabled) {
        return res.status(400).json({ success: false, error: 'MFA is not enabled' });
      }

      const secret = MfaService.decryptSecret(rows[0].mfa_secret);
      const isValid = await MfaService.verifyToken(token, secret);

      if (!isValid) {
        return res.status(401).json({ success: false, error: 'Invalid TOTP token' });
      }

      await pool.query(
        `UPDATE users SET mfa_enabled = false, mfa_secret = NULL, mfa_backup_codes = NULL WHERE id = $1`,
        [userId]
      );

      // Invalidate all sessions
      await pool.query(`UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = $1`, [userId]);

      await AuditLogService.log({
        userId,
        action: 'MFA_DISABLED',
        resourceType: 'auth',
        resourceId: userId,
        ipAddress: extractIpAddress(req),
        userAgent: req.headers['user-agent'] || null,
      });

      return res.status(200).json({ success: true, message: 'MFA disabled successfully' });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * Validate MFA token during login.
   */
  async validate(req: Request, res: Response) {
    try {
      const { mfaToken, otpToken } = req.body;

      if (!mfaToken || !otpToken) {
        return res.status(400).json({ success: false, error: 'MFA token and OTP token are required' });
      }

      // Verify short-lived MFA token
      let decoded: any;
      try {
        decoded = jwt.verify(mfaToken, env.JWT_SECRET);
      } catch (err) {
        return res.status(401).json({ success: false, error: 'MFA session expired' });
      }

      if (!decoded.mfaPending) {
        return res.status(401).json({ success: false, error: 'Invalid MFA session' });
      }

      const userId = decoded.sub;
      const { rows } = await pool.query(`SELECT mfa_secret, role, email FROM users WHERE id = $1`, [userId]);
      
      if (!rows.length || !rows[0].mfa_secret) {
        return res.status(400).json({ success: false, error: 'MFA not configured' });
      }

      const secret = MfaService.decryptSecret(rows[0].mfa_secret);
      const isValid = await MfaService.verifyToken(otpToken, secret);

      if (!isValid) {
        return res.status(401).json({ success: false, error: 'Invalid TOTP code' });
      }

      // MFA valid, generate full tokens
      const user = rows[0];
      const tokens = await AuthService.generateTokens(userId, user.role);

      await SessionManagerService.createSession({
        userId,
        refreshToken: tokens.refreshToken,
        ipAddress: extractIpAddress(req),
        userAgent: req.headers['user-agent'] || null,
        userEmail: user.email,
      });

      return res.status(200).json({
        success: true,
        data: {
          tokens,
          userId,
          role: user.role,
        },
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * Validate backup code during login.
   */
  async backup(req: Request, res: Response) {
    try {
      const { mfaToken, backupCode } = req.body;

      if (!mfaToken || !backupCode) {
        return res.status(400).json({ success: false, error: 'MFA token and backup code are required' });
      }

      // Verify short-lived MFA token
      let decoded: any;
      try {
        decoded = jwt.verify(mfaToken, env.JWT_SECRET);
      } catch (err) {
        return res.status(401).json({ success: false, error: 'MFA session expired' });
      }

      if (!decoded.mfaPending) {
        return res.status(401).json({ success: false, error: 'Invalid MFA session' });
      }

      const userId = decoded.sub;
      const isValid = await MfaService.verifyAndConsumeBackupCode(userId, backupCode);

      if (!isValid) {
        return res.status(401).json({ success: false, error: 'Invalid backup code' });
      }

      const { rows } = await pool.query(`SELECT role, email FROM users WHERE id = $1`, [userId]);
      const user = rows[0];
      const tokens = await AuthService.generateTokens(userId, user.role);

      await SessionManagerService.createSession({
        userId,
        refreshToken: tokens.refreshToken,
        ipAddress: extractIpAddress(req),
        userAgent: req.headers['user-agent'] || null,
        userEmail: user.email,
      });

      return res.status(200).json({
        success: true,
        data: {
          tokens,
          userId,
          role: user.role,
        },
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }
};
