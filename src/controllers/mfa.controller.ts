import { Request, Response } from 'express';
import { MfaService } from '../services/mfa.service';
import { UsersService } from '../services/users.service';
import { TokenService } from '../services/token.service';
import { SessionManagerService } from '../services/sessionManager.service';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import pool from '../config/database';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AuditLogService, extractIpAddress } from '../services/auditLog.service';
import { MfaDeviceType } from '../models/mfa-device.model';

export const MfaController = {
  // ─── Legacy TOTP Setup (backward compatible) ────────────────────────────

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
      const setup = await MfaService.setupTotpDevice({
        userId,
        email: user.email,
        name: req.body?.name,
      });
      await pool.query(
        `UPDATE users SET mfa_secret = $1 WHERE id = $2`,
        [setup.encryptedSecret, userId],
      );
      return res.status(200).json({
        success: true,
        data: {
          qrCodeUrl: setup.qrCodeUrl,
          manualEntryKey: setup.manualEntryKey,
          encryptedSecret: setup.encryptedSecret,
        },
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  },

  async verifySetup(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      const { token, encryptedSecret, name, setAsPrimary } = req.body;
      if (!userId || !token) {
        return res.status(400).json({ success: false, error: 'User ID and token are required' });
      }
      const secretToUse =
        encryptedSecret ||
        (await pool.query(`SELECT mfa_secret FROM users WHERE id = $1`, [userId]).then((r) => r.rows[0]?.mfa_secret));
      if (!secretToUse) {
        return res.status(400).json({ success: false, error: 'MFA setup not initiated' });
      }
      const result = await MfaService.confirmTotpDevice({
        userId,
        encryptedSecret: secretToUse,
        token,
        name,
        setAsPrimary,
      });
      if ('error' in result) {
        return res.status(401).json({ success: false, error: result.error });
      }
      await pool.query(
        `UPDATE users SET mfa_enabled = true, mfa_backup_codes = $1 WHERE id = $2`,
        [[], userId],
      );
      await pool.query(`UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = $1`, [userId]);
      await AuditLogService.log({
        userId,
        action: 'MFA_TOTP_DEVICE_ADDED',
        resourceType: 'mfa_device',
        resourceId: result.device.id,
        ipAddress: extractIpAddress(req),
        userAgent: req.headers['user-agent'] || null,
      });
      return res.status(200).json({
        success: true,
        message: 'Authenticator app added successfully',
        data: {
          deviceId: result.device.id,
          backupCodes: result.backupCodes,
        },
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  },

  async disable(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      const { token } = req.body;
      if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
      const { rows } = await pool.query(
        `SELECT mfa_secret, mfa_enabled FROM users WHERE id = $1`,
        [userId],
      );
      if (!rows.length || !rows[0].mfa_enabled) {
        return res.status(400).json({ success: false, error: 'MFA is not enabled' });
      }
      let verified = false;
      if (token && rows[0].mfa_secret) {
        const secret = await MfaService.decryptSecret(rows[0].mfa_secret);
        verified = await MfaService.verifyTotpToken(token, secret);
      }
      if (!verified) {
        const vr = await MfaService.verifyAndConsumeBackupCode(userId, token);
        verified = vr.valid;
      }
      if (!verified) {
        return res.status(401).json({ success: false, error: 'Invalid verification token' });
      }
      await pool.query(
        `UPDATE users SET mfa_enabled = false, mfa_secret = NULL, mfa_backup_codes = NULL WHERE id = $1`,
        [userId],
      );
      await pool.query(
        `UPDATE mfa_devices SET is_active = FALSE WHERE user_id = $1`,
        [userId],
      );
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

  async validate(req: Request, res: Response) {
    try {
      const { mfaToken, otpToken, method } = req.body;
      if (!mfaToken || !otpToken) {
        return res.status(400).json({ success: false, error: 'MFA token and OTP token are required' });
      }
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
      const chosenMethod: MfaDeviceType = (method as MfaDeviceType) || 'totp';
      const payload =
        chosenMethod === 'totp'
          ? { token: otpToken }
          : { code: otpToken };
      const v = await MfaService.verifyChallenge({
        userId,
        method: chosenMethod,
        payload,
      });
      if (!v.valid) {
        const bc = await MfaService.verifyAndConsumeBackupCode(userId, otpToken);
        if (!bc.valid) {
          await AuditLogService.log({
            userId,
            action: 'MFA_VALIDATE_FAILED',
            resourceType: 'auth',
            resourceId: userId,
            ipAddress: extractIpAddress(req),
            userAgent: req.headers['user-agent'] || null,
            metadata: { method: chosenMethod, reason: v.error || bc.valid ? undefined : 'bad_code' },
          });
          return res.status(401).json({ success: false, error: v.error || 'Invalid MFA code' });
        }
      }
      const { rows } = await pool.query(
        `SELECT role, email, user_tier FROM users WHERE id = $1`,
        [userId],
      );
      const user = rows[0];
      const tokens = await TokenService.issueTokens(
        userId,
        user.email,
        user.role,
        user.user_tier,
        undefined,
        undefined,
        true,
      );
      await SessionManagerService.createSession({
        userId,
        refreshToken: tokens.refreshToken,
        ipAddress: extractIpAddress(req),
        userAgent: req.headers['user-agent'] || null,
        userEmail: user.email,
      });
      await AuditLogService.log({
        userId,
        action: 'MFA_VALIDATE_SUCCESS',
        resourceType: 'auth',
        resourceId: userId,
        ipAddress: extractIpAddress(req),
        userAgent: req.headers['user-agent'] || null,
        metadata: { method: chosenMethod, deviceId: v.deviceId },
      });
      return res.status(200).json({
        success: true,
        data: { tokens, userId, role: user.role },
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  },

  async backup(req: Request, res: Response) {
    try {
      const { mfaToken, backupCode } = req.body;
      if (!mfaToken || !backupCode) {
        return res.status(400).json({ success: false, error: 'MFA token and backup code are required' });
      }
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
      const bc = await MfaService.verifyAndConsumeBackupCode(userId, backupCode);
      if (!bc.valid) {
        return res.status(401).json({ success: false, error: 'Invalid backup code' });
      }
      const { rows } = await pool.query(
        `SELECT role, email, user_tier FROM users WHERE id = $1`,
        [userId],
      );
      const user = rows[0];
      const tokens = await TokenService.issueTokens(
        userId,
        user.email,
        user.role,
        user.user_tier,
        undefined,
        undefined,
        true,
      );
      await SessionManagerService.createSession({
        userId,
        refreshToken: tokens.refreshToken,
        ipAddress: extractIpAddress(req),
        userAgent: req.headers['user-agent'] || null,
        userEmail: user.email,
      });
      await AuditLogService.log({
        userId,
        action: 'MFA_BACKUP_CODE_USED',
        resourceType: 'auth',
        resourceId: userId,
        ipAddress: extractIpAddress(req),
        userAgent: req.headers['user-agent'] || null,
      });
      return res.status(200).json({
        success: true,
        data: { tokens, userId, role: user.role },
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  },

  // ─── Status & Devices ───────────────────────────────────────────────────

  async status(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
      const status = await MfaService.getStatus(userId);
      return res.status(200).json({ success: true, data: status });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  },

  async listDevices(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
      const devices = await MfaService.listDevices(userId);
      const sanitized = devices.map((d) => ({
        id: d.id,
        type: d.type,
        name: d.name,
        isPrimary: d.is_primary,
        isActive: d.is_active,
        lastUsedAt: d.last_used_at,
        createdAt: d.created_at,
        phoneLast4: d.phone_number ? d.phone_number.slice(-4) : null,
        emailMasked: d.email_address
          ? d.email_address.replace(/^(.{2})(.*)(@.*)$/, (_m, a, b, c) => `${a}${'*'.repeat(Math.max(0, b.length))}${c}`)
          : null,
        aaguid: d.aaguid,
        authenticatorAttachment: d.authenticator_attachment,
        backupCodesRemaining: d.backup_codes_hashed?.length ?? 0,
      }));
      return res.status(200).json({ success: true, data: sanitized });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  },

  async renameDevice(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      const { id } = req.params;
      const { name } = req.body;
      if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
      if (!name || typeof name !== 'string' || name.length > 100) {
        return res.status(400).json({ success: false, error: 'Valid name (max 100 chars) is required' });
      }
      const userIdStr = Array.isArray(userId) ? userId[0] : userId;
      const ok = await MfaService.renameDevice(userIdStr, id, name.trim());
      if (!ok) return res.status(404).json({ success: false, error: 'Device not found' });
      await AuditLogService.log({
        userId: userIdStr,
        action: 'MFA_DEVICE_RENAMED',
        resourceType: 'mfa_device',
        resourceId: id,
        ipAddress: extractIpAddress(req),
        userAgent: req.headers['user-agent'] || null,
      });
      return res.status(200).json({ success: true });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  },

  async setPrimaryDevice(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      const { id } = req.params;
      if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
      const userIdStr = Array.isArray(userId) ? userId[0] : userId;
      const ok = await MfaService.setPrimaryDevice(userIdStr, id);
      if (!ok) return res.status(404).json({ success: false, error: 'Device not found' });
      await AuditLogService.log({
        userId: userIdStr,
        action: 'MFA_DEVICE_PRIMARY_SET',
        resourceType: 'mfa_device',
        resourceId: id,
        ipAddress: extractIpAddress(req),
        userAgent: req.headers['user-agent'] || null,
      });
      return res.status(200).json({ success: true });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  },

  async removeDevice(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      const { id } = req.params;
      const { verification } = req.body;
      if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
      if (!verification?.token) {
        return res.status(400).json({ success: false, error: 'Verification token required' });
      }
      const userIdStr = Array.isArray(userId) ? userId[0] : userId;
      const v = await MfaService.verifyChallenge({
        userId: userIdStr,
        method: 'totp',
        payload: { token: verification.token },
      });
      let verified = v.valid;
      if (!verified) {
        const bc = await MfaService.verifyAndConsumeBackupCode(userIdStr, verification.token);
        verified = bc.valid;
      }
      if (!verified) {
        return res.status(401).json({ success: false, error: 'Invalid verification token' });
      }
      const ok = await MfaService.removeDevice(userIdStr, id);
      if (!ok) return res.status(404).json({ success: false, error: 'Device not found' });
      await AuditLogService.log({
        userId: userIdStr,
        action: 'MFA_DEVICE_REMOVED',
        resourceType: 'mfa_device',
        resourceId: id,
        ipAddress: extractIpAddress(req),
        userAgent: req.headers['user-agent'] || null,
      });
      return res.status(200).json({ success: true });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  },

  // ─── SMS Device Setup ───────────────────────────────────────────────────

  async smsSetupSend(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      const { phoneNumber, name } = req.body;
      if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
      if (!phoneNumber) {
        return res.status(400).json({ success: false, error: 'phoneNumber is required' });
      }
      const r = await MfaService.setupSmsDevice({ userId, phoneNumber, name });
      if (!r.success) return res.status(400).json({ success: false, error: r.error });
      await AuditLogService.log({
        userId,
        action: 'MFA_SMS_SETUP_CODE_SENT',
        resourceType: 'mfa_device',
        ipAddress: extractIpAddress(req),
        userAgent: req.headers['user-agent'] || null,
      });
      return res.status(200).json({ success: true, data: { expiresAt: r.expiresAt } });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  },

  async smsSetupConfirm(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      const { phoneNumber, otpCode, name, setAsPrimary } = req.body;
      if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
      if (!phoneNumber || !otpCode) {
        return res.status(400).json({ success: false, error: 'phoneNumber and otpCode are required' });
      }
      const r = await MfaService.confirmSmsDevice({
        userId,
        phoneNumber,
        otpCode,
        name,
        setAsPrimary,
      });
      if ('error' in r) return res.status(400).json({ success: false, error: r.error });
      await AuditLogService.log({
        userId,
        action: 'MFA_SMS_DEVICE_ADDED',
        resourceType: 'mfa_device',
        resourceId: r.device.id,
        ipAddress: extractIpAddress(req),
        userAgent: req.headers['user-agent'] || null,
      });
      return res.status(200).json({ success: true, data: { deviceId: r.device.id } });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  },

  // ─── Email Device Setup ─────────────────────────────────────────────────

  async emailSetupSend(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      const { emailAddress, name } = req.body;
      if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
      if (!emailAddress) {
        return res.status(400).json({ success: false, error: 'emailAddress is required' });
      }
      const r = await MfaService.setupEmailDevice({ userId, emailAddress, name });
      if (!r.success) return res.status(400).json({ success: false, error: r.error });
      await AuditLogService.log({
        userId,
        action: 'MFA_EMAIL_SETUP_CODE_SENT',
        resourceType: 'mfa_device',
        ipAddress: extractIpAddress(req),
        userAgent: req.headers['user-agent'] || null,
      });
      return res.status(200).json({ success: true, data: { expiresAt: r.expiresAt } });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  },

  async emailSetupConfirm(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      const { emailAddress, otpCode, name, setAsPrimary } = req.body;
      if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
      if (!emailAddress || !otpCode) {
        return res.status(400).json({ success: false, error: 'emailAddress and otpCode are required' });
      }
      const r = await MfaService.confirmEmailDevice({
        userId,
        emailAddress,
        otpCode,
        name,
        setAsPrimary,
      });
      if ('error' in r) return res.status(400).json({ success: false, error: r.error });
      await AuditLogService.log({
        userId,
        action: 'MFA_EMAIL_DEVICE_ADDED',
        resourceType: 'mfa_device',
        resourceId: r.device.id,
        ipAddress: extractIpAddress(req),
        userAgent: req.headers['user-agent'] || null,
      });
      return res.status(200).json({ success: true, data: { deviceId: r.device.id } });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  },

  // ─── WebAuthn / FIDO2 ───────────────────────────────────────────────────

  async webauthnRegisterOptions(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      const { authenticatorAttachment, userVerification } = req.body || {};
      if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
      const user = await UsersService.findById(userId);
      if (!user) return res.status(404).json({ success: false, error: 'User not found' });
      const opts = await MfaService.webauthn.generateRegistrationOptions({
        userId,
        userName: user.email,
        userDisplayName: user.full_name || user.email,
        authenticatorAttachment,
        userVerification,
      });
      return res.status(200).json({ success: true, data: opts });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  },

  async webauthnRegisterVerify(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      const { credential, deviceName, setAsPrimary } = req.body;
      if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
      if (!credential) return res.status(400).json({ success: false, error: 'credential is required' });
      const r = await MfaService.webauthn.verifyRegistration({
        userId,
        credential,
        deviceName,
      });
      if ('error' in r) return res.status(400).json({ success: false, error: r.error });
      if (setAsPrimary) {
        await MfaService.setPrimaryDevice(userId, r.device.id);
      }
      await AuditLogService.log({
        userId,
        action: 'MFA_WEBAUTHN_DEVICE_ADDED',
        resourceType: 'mfa_device',
        resourceId: r.device.id,
        ipAddress: extractIpAddress(req),
        userAgent: req.headers['user-agent'] || null,
        metadata: { aaguid: r.device.aaguid, attachment: r.device.authenticator_attachment },
      });
      return res.status(200).json({
        success: true,
        data: {
          deviceId: r.device.id,
          aaguid: r.device.aaguid,
          authenticatorAttachment: r.device.authenticator_attachment,
        },
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  },

  async webauthnAuthenticateOptions(req: Request, res: Response) {
    try {
      const { mfaToken } = req.body;
      let userId: string;
      if (mfaToken) {
        const decoded: any = jwt.verify(mfaToken, env.JWT_SECRET);
        if (!decoded.mfaPending) {
          return res.status(401).json({ success: false, error: 'Invalid MFA session' });
        }
        userId = decoded.sub;
      } else {
        const authReq = req as AuthenticatedRequest;
        if (!authReq.user?.userId) {
          return res.status(401).json({ success: false, error: 'Unauthorized' });
        }
        userId = authReq.user.userId;
      }
      const opts = await MfaService.webauthn.generateAuthenticationOptions({ userId });
      return res.status(200).json({ success: true, data: opts });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  },

  // ─── Challenge Initiation / Verification (Login flow) ────────────────────

  async initiateChallenge(req: Request, res: Response) {
    try {
      const { mfaToken, method } = req.body;
      let userId: string;
      let defaultEmail: string | undefined;
      if (mfaToken) {
        const decoded: any = jwt.verify(mfaToken, env.JWT_SECRET);
        if (!decoded.mfaPending) {
          return res.status(401).json({ success: false, error: 'Invalid MFA session' });
        }
        userId = decoded.sub;
        defaultEmail = decoded.email;
      } else {
        const authReq = req as AuthenticatedRequest;
        if (!authReq.user?.userId) {
          return res.status(401).json({ success: false, error: 'Unauthorized' });
        }
        userId = authReq.user.userId;
      }
      const r = await MfaService.initiateChallenge({
        userId,
        method: method as MfaDeviceType,
        defaultEmail,
      });
      if (!r.success) return res.status(400).json({ success: false, error: r.error });
      return res.status(200).json({ success: true, data: r.data });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  },

  async verifyChallenge(req: Request, res: Response) {
    try {
      const { mfaToken, method, payload } = req.body;
      if (!method || !payload) {
        return res.status(400).json({ success: false, error: 'method and payload are required' });
      }
      let userId: string;
      if (mfaToken) {
        const decoded: any = jwt.verify(mfaToken, env.JWT_SECRET);
        if (!decoded.mfaPending) {
          return res.status(401).json({ success: false, error: 'Invalid MFA session' });
        }
        userId = decoded.sub;
        const v = await MfaService.verifyChallenge({
          userId,
          method: method as MfaDeviceType,
          payload,
        });
        if (!v.valid) {
          const bc = await MfaService.verifyAndConsumeBackupCode(userId, payload?.code || payload?.token || payload);
          if (!bc.valid) {
            return res.status(401).json({ success: false, error: v.error || 'Invalid MFA input' });
          }
        }
        const { rows } = await pool.query(
          `SELECT role, email, user_tier FROM users WHERE id = $1`,
          [userId],
        );
        const user = rows[0];
        const tokens = await TokenService.issueTokens(
          userId,
          user.email,
          user.role,
          user.user_tier,
          undefined,
          undefined,
          true,
        );
        await SessionManagerService.createSession({
          userId,
          refreshToken: tokens.refreshToken,
          ipAddress: extractIpAddress(req),
          userAgent: req.headers['user-agent'] || null,
          userEmail: user.email,
        });
        await AuditLogService.log({
          userId,
          action: 'MFA_LOGIN_SUCCESS',
          resourceType: 'auth',
          resourceId: userId,
          ipAddress: extractIpAddress(req),
          userAgent: req.headers['user-agent'] || null,
          metadata: { method, deviceId: v.deviceId },
        });
        return res.status(200).json({
          success: true,
          data: { tokens, userId, role: user.role },
        });
      }
      const authReq = req as AuthenticatedRequest;
      if (!authReq.user?.userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }
      userId = authReq.user.userId;
      const v = await MfaService.verifyChallenge({
        userId,
        method: method as MfaDeviceType,
        payload,
      });
      if (!v.valid) return res.status(401).json({ success: false, error: v.error || 'Invalid MFA input' });
      return res.status(200).json({ success: true, data: { deviceId: v.deviceId } });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  },

  // ─── Backup Codes ───────────────────────────────────────────────────────

  async regenerateBackupCodes(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      const { deviceId, verification } = req.body;
      if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
      if (!verification?.token) {
        return res.status(400).json({ success: false, error: 'Verification token required' });
      }
      const v = await MfaService.verifyChallenge({
        userId,
        method: 'totp',
        payload: { token: verification.token },
      });
      let verified = v.valid;
      if (!verified) {
        const bc = await MfaService.verifyAndConsumeBackupCode(userId, verification.token);
        verified = bc.valid;
      }
      if (!verified) {
        return res.status(401).json({ success: false, error: 'Invalid verification token' });
      }
      const r = await MfaService.regenerateBackupCodes(userId, deviceId);
      if ('error' in r) return res.status(400).json({ success: false, error: r.error });
      await AuditLogService.log({
        userId,
        action: 'MFA_BACKUP_CODES_REGENERATED',
        resourceType: 'mfa_device',
        resourceId: deviceId || userId,
        ipAddress: extractIpAddress(req),
        userAgent: req.headers['user-agent'] || null,
      });
      return res.status(200).json({ success: true, data: { backupCodes: r.plain } });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  },
};
