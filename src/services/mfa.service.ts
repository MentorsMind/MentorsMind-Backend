import { TOTP, NobleCryptoPlugin, ScureBase32Plugin } from 'otplib';
import QRCode from 'qrcode';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import pool from '../config/database';
import { EncryptionUtil } from '../utils/encryption.utils';
import { env } from '../config/env';
import {
  MfaDeviceModel,
  MfaDevice,
  MfaDeviceType,
} from '../models/mfa-device.model';
import { SmsService } from './sms.service';
import { WebAuthnService } from './webauthn.service';
import { EmailService } from './email.service';
import { RateLimiterService } from './rate-limiter.service';
import { logger } from '../utils/logger.utils';

const authenticator = new TOTP({
  crypto: new NobleCryptoPlugin(),
  base32: new ScureBase32Plugin(),
});

const EMAIL_RATE_WINDOW_MS = 60 * 1000;
const EMAIL_RATE_MAX = 5;
const EMAIL_DAILY_MAX = 30;
const EMAIL_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
const BACKUP_CODE_COUNT = 10;

export interface BackupCodeSet {
  plain: string[];
  hashed: string[];
}

export interface SendSmsOtpResult {
  success: boolean;
  error?: string;
  expiresAt?: Date;
}

export interface SendEmailOtpResult {
  success: boolean;
  error?: string;
  expiresAt?: Date;
}

export interface MfaMethodSummary {
  type: MfaDeviceType;
  enabled: boolean;
  count: number;
  hasPrimary: boolean;
}

export interface MfaStatus {
  enabled: boolean;
  methods: MfaMethodSummary[];
  backupCodesRemaining: number;
  devices: Array<{
    id: string;
    type: MfaDeviceType;
    name: string | null;
    isPrimary: boolean;
    lastUsedAt: Date | null;
    createdAt: Date;
  }>;
}

const emailServiceInstance = new EmailService();

export const MfaService = {
  // ─── TOTP ────────────────────────────────────────────────────────────────

  generateSecret(): string {
    return authenticator.generateSecret();
  },

  async generateQrCode(email: string, secret: string): Promise<string> {
    const otpauth = authenticator.toURI({
      label: email,
      issuer: env.MFA_TOTP_ISSUER,
      secret,
    });
    return QRCode.toDataURL(otpauth);
  },

  async verifyTotpToken(token: string, secret: string): Promise<boolean> {
    const result = await authenticator.verify(token, { secret });
    return result.valid;
  },

  async encryptSecret(secret: string): Promise<string> {
    const encrypted = await EncryptionUtil.encrypt(secret);
    if (!encrypted) throw new Error('Encryption failed');
    return encrypted;
  },

  async decryptSecret(encryptedSecret: string): Promise<string> {
    const decrypted = await EncryptionUtil.decrypt(encryptedSecret);
    if (!decrypted) throw new Error('Decryption failed');
    return decrypted;
  },

  // ─── Backup Codes ────────────────────────────────────────────────────────

  async generateBackupCodesAsync(count: number = BACKUP_CODE_COUNT): Promise<BackupCodeSet> {
    const plain: string[] = [];
    for (let i = 0; i < count; i++) {
      const code = this.formatBackupCode(crypto.randomBytes(5).toString('hex'));
      plain.push(code);
    }
    // Parallelize bcrypt hashing to avoid blocking the event loop
    const hashed = await Promise.all(
      plain.map(code => bcrypt.hash(code, 12))
    );
    return { plain, hashed };
  },

  generateBackupCodes(count: number = BACKUP_CODE_COUNT): BackupCodeSet {
    const plain: string[] = [];
    const hashed: string[] = [];
    for (let i = 0; i < count; i++) {
      const code = this.formatBackupCode(crypto.randomBytes(5).toString('hex'));
      plain.push(code);
      hashed.push(bcrypt.hashSync(code, bcrypt.genSaltSync(12)));
    }
    return { plain, hashed };
  },

  formatBackupCode(raw: string): string {
    const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
    if (clean.length <= 5) return clean;
    return `${clean.slice(0, 5)}-${clean.slice(5)}`;
  },

  async verifyAndConsumeBackupCode(
    userId: string,
    code: string,
  ): Promise<{ valid: boolean; deviceId?: string }> {
    const normalized = code.toUpperCase().trim();
    const devices = await MfaDeviceModel.listByUser(userId);
    for (const device of devices) {
      if (!device.backup_codes_hashed?.length) continue;
      let idx = -1;
      for (let i = 0; i < device.backup_codes_hashed.length; i++) {
        if (bcrypt.compareSync(normalized, device.backup_codes_hashed[i])) {
          idx = i;
          break;
        }
      }
      if (idx >= 0) {
        const updated = device.backup_codes_hashed.filter((_, i) => i !== idx);
        await pool.query(
          `UPDATE mfa_devices SET backup_codes_hashed = $1 WHERE id = $2`,
          [updated, device.id],
        );
        await MfaDeviceModel.touchLastUsed(device.id);
        return { valid: true, deviceId: device.id };
      }
    }
    // Legacy: check users.mfa_backup_codes
    const { rows } = await pool.query(
      `SELECT mfa_backup_codes FROM users WHERE id = $1`,
      [userId],
    );
    const legacy: string[] = rows[0]?.mfa_backup_codes || [];
    for (let i = 0; i < legacy.length; i++) {
      if (bcrypt.compareSync(normalized, legacy[i])) {
        const updated = legacy.filter((_, x) => x !== i);
        await pool.query(
          `UPDATE users SET mfa_backup_codes = $1 WHERE id = $2`,
          [updated, userId],
        );
        return { valid: true };
      }
    }
    return { valid: false };
  },

  async countBackupCodesRemaining(userId: string): Promise<number> {
    const devices = await MfaDeviceModel.listByUser(userId);
    let count = 0;
    for (const d of devices) {
      if (d.backup_codes_hashed?.length) count += d.backup_codes_hashed.length;
    }
    const { rows } = await pool.query(
      `SELECT mfa_backup_codes FROM users WHERE id = $1`,
      [userId],
    );
    count += (rows[0]?.mfa_backup_codes || []).length;
    return count;
  },

  async regenerateBackupCodes(
    userId: string,
    deviceId?: string,
  ): Promise<{ plain: string[] } | { error: string }> {
    const { plain, hashed } = await this.generateBackupCodesAsync();
    if (deviceId) {
      const owns = await MfaDeviceModel.findById(deviceId, userId);
      if (!owns) return { error: 'Device not found' };
      await pool.query(
        `UPDATE mfa_devices SET backup_codes_hashed = $1 WHERE id = $2`,
        [hashed, deviceId],
      );
    } else {
      await pool.query(
        `UPDATE users SET mfa_backup_codes = $1 WHERE id = $2`,
        [hashed, userId],
      );
    }
    return { plain };
  },

  // ─── TOTP Device Management ─────────────────────────────────────────────

  async setupTotpDevice(params: {
    userId: string;
    email: string;
    name?: string;
  }): Promise<{
    secret: string;
    encryptedSecret: string;
    qrCodeUrl: string;
    manualEntryKey: string;
  }> {
    const secret = this.generateSecret();
    const [qrCodeUrl, encryptedSecret] = await Promise.all([
      this.generateQrCode(params.email, secret),
      this.encryptSecret(secret),
    ]);
    return {
      secret,
      encryptedSecret,
      qrCodeUrl,
      manualEntryKey: secret,
    };
  },

  async confirmTotpDevice(params: {
    userId: string;
    encryptedSecret: string;
    token: string;
    name?: string;
    setAsPrimary?: boolean;
  }): Promise<{ device: MfaDevice; backupCodes: string[] } | { error: string }> {
    const secret = await this.decryptSecret(params.encryptedSecret);
    const valid = await this.verifyTotpToken(params.token, secret);
    if (!valid) return { error: 'Invalid verification code' };
    const { plain, hashed } = await this.generateBackupCodesAsync();
    const device = await MfaDeviceModel.createTotp({
      userId: params.userId,
      name: params.name,
      encryptedSecret: params.encryptedSecret,
      backupCodesHashed: hashed,
    });
    if (params.setAsPrimary) {
      await MfaDeviceModel.setPrimary(device.id, params.userId);
    }
    return { device, backupCodes: plain };
  },

  // ─── SMS MFA ─────────────────────────────────────────────────────────────

  async setupSmsDevice(params: {
    userId: string;
    phoneNumber: string;
    name?: string;
  }): Promise<SendSmsOtpResult> {
    const normalized = SmsService.normalizePhone(params.phoneNumber);
    const rate = await SmsService.checkRateLimits(params.userId, normalized);
    if (!rate.allowed) {
      return { success: false, error: rate.reason };
    }
    const { code, expiresAt } = SmsService.generateOtp();
    await SmsService.storeOtp({
      userId: params.userId,
      method: 'sms',
      code,
      expiresAt,
      phoneOrEmail: normalized,
    });
    const body = `Your MentorMinds verification code is: ${code}. Valid for 5 minutes.`;
    const r = await SmsService.send(normalized, body);
    if (!r.success) {
      return { success: false, error: r.error || 'Failed to send SMS' };
    }
    return { success: true, expiresAt };
  },

  async confirmSmsDevice(params: {
    userId: string;
    phoneNumber: string;
    otpCode: string;
    name?: string;
    setAsPrimary?: boolean;
  }): Promise<{ device: MfaDevice } | { error: string }> {
    const normalized = SmsService.normalizePhone(params.phoneNumber);
    const check = await SmsService.verifyAndConsumeOtp({
      userId: params.userId,
      method: 'sms',
      code: params.otpCode,
    });
    if (!check.valid) return { error: check.reason || 'Invalid or expired code' };
    const device = await MfaDeviceModel.createSms({
      userId: params.userId,
      name: params.name,
      phoneNumber: normalized,
    });
    if (params.setAsPrimary) {
      await MfaDeviceModel.setPrimary(device.id, params.userId);
    }
    return { device };
  },

  async sendSmsChallenge(userId: string): Promise<SendSmsOtpResult> {
    const devices = await MfaDeviceModel.listByUserAndType(userId, 'sms');
    const device = devices.find((d) => d.is_primary) || devices[0];
    if (!device || !device.phone_number) {
      return { success: false, error: 'No SMS device configured' };
    }
    const rate = await SmsService.checkRateLimits(userId, device.phone_number);
    if (!rate.allowed) return { success: false, error: rate.reason };
    const { code, expiresAt } = SmsService.generateOtp();
    await SmsService.storeOtp({
      userId,
      method: 'sms',
      code,
      expiresAt,
      phoneOrEmail: device.phone_number,
    });
    const body = `Your MentorMinds login code is: ${code}. Valid for 5 minutes.`;
    const r = await SmsService.send(device.phone_number, body);
    if (!r.success) return { success: false, error: r.error || 'Failed to send SMS' };
    return { success: true, expiresAt };
  },

  async verifySmsChallenge(
    userId: string,
    otpCode: string,
  ): Promise<{ valid: boolean; deviceId?: string; reason?: string }> {
    const devices = await MfaDeviceModel.listByUserAndType(userId, 'sms');
    if (!devices.length) return { valid: false, reason: 'No SMS device' };
    const r = await SmsService.verifyAndConsumeOtp({ userId, method: 'sms', code: otpCode });
    if (!r.valid) return { valid: false, reason: r.reason };
    const device = devices.find((d) => d.is_primary) || devices[0];
    await MfaDeviceModel.touchLastUsed(device.id);
    return { valid: true, deviceId: device.id };
  },

  // ─── Email MFA ───────────────────────────────────────────────────────────

  async checkEmailRateLimits(userId: string, email: string): Promise<{
    allowed: boolean;
    reason?: string;
  }> {
    const perMin = await RateLimiterService.check(
      `mfa:email:user:${userId}`,
      EMAIL_RATE_WINDOW_MS,
      EMAIL_RATE_MAX,
    );
    if (!perMin.allowed) {
      return { allowed: false, reason: 'Rate limit exceeded: please wait a minute before requesting another code' };
    }
    const perAddr = await RateLimiterService.check(
      `mfa:email:addr:${email}`,
      EMAIL_RATE_WINDOW_MS,
      EMAIL_RATE_MAX,
    );
    if (!perAddr.allowed) {
      return { allowed: false, reason: 'Rate limit exceeded for this email address' };
    }
    const perDay = await RateLimiterService.check(
      `mfa:email:addr:daily:${email}`,
      EMAIL_DAILY_WINDOW_MS,
      EMAIL_DAILY_MAX,
    );
    if (!perDay.allowed) {
      return { allowed: false, reason: 'Daily email limit reached for this address' };
    }
    return { allowed: true };
  },

  async setupEmailDevice(params: {
    userId: string;
    emailAddress: string;
    name?: string;
  }): Promise<SendEmailOtpResult> {
    const rate = await this.checkEmailRateLimits(params.userId, params.emailAddress);
    if (!rate.allowed) return { success: false, error: rate.reason };
    const { code, expiresAt } = SmsService.generateOtp();
    await SmsService.storeOtp({
      userId: params.userId,
      method: 'email',
      code,
      expiresAt,
      phoneOrEmail: params.emailAddress,
    });
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto;">
        <h2 style="color: #4F46E5;">MentorMinds Email Verification</h2>
        <p>Your email verification code is:</p>
        <div style="background: #F5F3FF; padding: 16px; border-radius: 8px; text-align: center;">
          <span style="font-size: 28px; font-weight: bold; letter-spacing: 4px; color: #4F46E5;">${code}</span>
        </div>
        <p style="color: #6B7280; font-size: 14px;">
          This code is valid for 5 minutes. If you didn't request this, please ignore this email.
        </p>
      </div>
    `;
    const text = `Your MentorMinds verification code is: ${code}. Valid for 5 minutes.`;
    const result = await emailServiceInstance.sendEmail({
      to: [params.emailAddress],
      subject: 'MentorMinds — Email MFA Verification',
      htmlContent: html,
      textContent: text,
      priority: 'high',
    });
    if (!result.success) {
      return { success: false, error: result.error || 'Failed to send email' };
    }
    return { success: true, expiresAt };
  },

  async confirmEmailDevice(params: {
    userId: string;
    emailAddress: string;
    otpCode: string;
    name?: string;
    setAsPrimary?: boolean;
  }): Promise<{ device: MfaDevice } | { error: string }> {
    const r = await SmsService.verifyAndConsumeOtp({
      userId: params.userId,
      method: 'email',
      code: params.otpCode,
    });
    if (!r.valid) return { error: r.reason || 'Invalid or expired code' };
    const device = await MfaDeviceModel.createEmail({
      userId: params.userId,
      name: params.name,
      emailAddress: params.emailAddress,
    });
    if (params.setAsPrimary) {
      await MfaDeviceModel.setPrimary(device.id, params.userId);
    }
    return { device };
  },

  async sendEmailChallenge(params: {
    userId: string;
    defaultEmail?: string;
  }): Promise<SendEmailOtpResult> {
    const devices = await MfaDeviceModel.listByUserAndType(params.userId, 'email');
    const device = devices.find((d) => d.is_primary) || devices[0];
    const email = device?.email_address || params.defaultEmail;
    if (!email) return { success: false, error: 'No email address configured' };
    const rate = await this.checkEmailRateLimits(params.userId, email);
    if (!rate.allowed) return { success: false, error: rate.reason };
    const { code, expiresAt } = SmsService.generateOtp();
    await SmsService.storeOtp({
      userId: params.userId,
      method: 'email',
      code,
      expiresAt,
      phoneOrEmail: email,
    });
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto;">
        <h2 style="color: #4F46E5;">MentorMinds Login Verification</h2>
        <p>Your login verification code is:</p>
        <div style="background: #F5F3FF; padding: 16px; border-radius: 8px; text-align: center;">
          <span style="font-size: 28px; font-weight: bold; letter-spacing: 4px; color: #4F46E5;">${code}</span>
        </div>
        <p style="color: #6B7280; font-size: 14px;">
          This code is valid for 5 minutes. If you didn't request this, please secure your account immediately.
        </p>
      </div>
    `;
    const text = `Your MentorMinds login code is: ${code}. Valid for 5 minutes.`;
    const result = await emailServiceInstance.sendEmail({
      to: [email],
      subject: 'MentorMinds — Login Verification Code',
      htmlContent: html,
      textContent: text,
      priority: 'high',
    });
    if (!result.success) return { success: false, error: result.error || 'Failed to send email' };
    return { success: true, expiresAt };
  },

  async verifyEmailChallenge(
    userId: string,
    otpCode: string,
  ): Promise<{ valid: boolean; deviceId?: string; reason?: string }> {
    const devices = await MfaDeviceModel.listByUserAndType(userId, 'email');
    const r = await SmsService.verifyAndConsumeOtp({ userId, method: 'email', code: otpCode });
    if (!r.valid) return { valid: false, reason: r.reason };
    if (devices.length) {
      const device = devices.find((d) => d.is_primary) || devices[0];
      await MfaDeviceModel.touchLastUsed(device.id);
      return { valid: true, deviceId: device.id };
    }
    return { valid: true };
  },

  // ─── WebAuthn pass-through ───────────────────────────────────────────────

  webauthn: WebAuthnService,

  // ─── Unified Challenge / Verify ──────────────────────────────────────────

  async initiateChallenge(params: {
    userId: string;
    method: MfaDeviceType;
    defaultEmail?: string;
  }): Promise<{ success: boolean; data?: any; error?: string }> {
    switch (params.method) {
      case 'sms': {
        const r = await this.sendSmsChallenge(params.userId);
        return r.success
          ? { success: true, data: { expiresAt: r.expiresAt } }
          : { success: false, error: r.error };
      }
      case 'email': {
        const r = await this.sendEmailChallenge({
          userId: params.userId,
          defaultEmail: params.defaultEmail,
        });
        return r.success
          ? { success: true, data: { expiresAt: r.expiresAt } }
          : { success: false, error: r.error };
      }
      case 'webauthn': {
        const opts = await WebAuthnService.generateAuthenticationOptions({
          userId: params.userId,
        });
        return { success: true, data: opts };
      }
      case 'totp':
      default:
        return { success: true, data: { hint: 'Enter code from authenticator app' } };
    }
  },

  async verifyChallenge(params: {
    userId: string;
    method: MfaDeviceType;
    payload: any;
  }): Promise<{ valid: boolean; deviceId?: string; error?: string }> {
    switch (params.method) {
      case 'totp': {
        const devices = await MfaDeviceModel.listByUserAndType(params.userId, 'totp');
        const token: string = String(params.payload?.token || params.payload || '');
        for (const d of devices) {
          if (!d.encrypted_secret) continue;
          try {
            const secret = await this.decryptSecret(d.encrypted_secret);
            if (await this.verifyTotpToken(token, secret)) {
              await MfaDeviceModel.touchLastUsed(d.id);
              return { valid: true, deviceId: d.id };
            }
          } catch (e) {
            logger.warn('MFA TOTP decrypt error', { deviceId: d.id });
          }
        }
        // Legacy fallback: users.mfa_secret
        const { rows } = await pool.query(
          `SELECT mfa_secret FROM users WHERE id = $1 AND mfa_enabled = TRUE`,
          [params.userId],
        );
        if (rows[0]?.mfa_secret) {
          const secret = await this.decryptSecret(rows[0].mfa_secret);
          if (await this.verifyTotpToken(token, secret)) {
            return { valid: true };
          }
        }
        return { valid: false, error: 'Invalid TOTP code' };
      }
      case 'sms':
        return this.verifySmsChallenge(params.userId, String(params.payload?.code || params.payload));
      case 'email':
        return this.verifyEmailChallenge(params.userId, String(params.payload?.code || params.payload));
      case 'webauthn': {
        const r = await WebAuthnService.verifyAuthentication({
          userId: params.userId,
          credential: params.payload,
        });
        return {
          valid: r.success,
          deviceId: r.device?.id,
          error: r.error,
        };
      }
      default:
        return { valid: false, error: 'Unknown MFA method' };
    }
  },

  // ─── Device Management ───────────────────────────────────────────────────

  async listDevices(userId: string): Promise<MfaDevice[]> {
    return MfaDeviceModel.listByUser(userId);
  },

  async getDevice(userId: string, deviceId: string): Promise<MfaDevice | null> {
    return MfaDeviceModel.findById(deviceId, userId);
  },

  async renameDevice(
    userId: string,
    deviceId: string,
    name: string,
  ): Promise<boolean> {
    return MfaDeviceModel.rename(deviceId, userId, name);
  },

  async setPrimaryDevice(userId: string, deviceId: string): Promise<boolean> {
    return MfaDeviceModel.setPrimary(deviceId, userId);
  },

  async removeDevice(userId: string, deviceId: string): Promise<boolean> {
    return MfaDeviceModel.remove(deviceId, userId);
  },

  async deactivateDevice(userId: string, deviceId: string): Promise<boolean> {
    return MfaDeviceModel.deactivate(deviceId, userId);
  },

  // ─── Status Aggregation ──────────────────────────────────────────────────

  async getStatus(userId: string): Promise<MfaStatus> {
    const devices = await MfaDeviceModel.listByUser(userId);
    const types: MfaDeviceType[] = ['totp', 'sms', 'email', 'webauthn'];
    const methods: MfaMethodSummary[] = types.map((t) => {
      const ofType = devices.filter((d) => d.type === t);
      return {
        type: t,
        enabled: ofType.some((d) => d.is_active),
        count: ofType.filter((d) => d.is_active).length,
        hasPrimary: ofType.some((d) => d.is_primary),
      };
    });
    const backupCodesRemaining = await this.countBackupCodesRemaining(userId);
    return {
      enabled: devices.some((d) => d.is_active),
      methods,
      backupCodesRemaining,
      devices: devices.map((d) => ({
        id: d.id,
        type: d.type,
        name: d.name,
        isPrimary: d.is_primary,
        lastUsedAt: d.last_used_at,
        createdAt: d.created_at,
      })),
    };
  },
};
