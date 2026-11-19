import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';
import pool from '../config/database';
import { env } from '../config/env';
import { RateLimiterService } from './rate-limiter.service';
import { logger } from '../utils/logger.utils';

export type SmsProvider = 'twilio' | 'aws_sns' | 'mock';

export interface SendSmsResult {
  success: boolean;
  error?: string;
  provider?: SmsProvider;
  messageId?: string;
}

export interface GenerateOtpResult {
  code: string;
  expiresAt: Date;
}

const OTP_LENGTH = 6;
const OTP_TTL_SECONDS = 5 * 60; // 5 minutes
const SMS_RATE_WINDOW_MS = 60 * 1000; // 1 minute
const SMS_RATE_MAX = 5; // 5 messages per minute per user
const SMS_DAILY_MAX = 30; // 30 messages per day per number
const SMS_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;

function generateNumericOtp(length: number = OTP_LENGTH): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += Math.floor(Math.random() * 10).toString();
  }
  return code;
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('00')) return '+' + digits.slice(2);
  if (digits.startsWith('+')) return '+' + digits.slice(1);
  if (digits.length === 10) return '+1' + digits;
  return '+' + digits;
}

function getSmsProvider(): SmsProvider {
  const p = env.SMS_PROVIDER?.toLowerCase();
  if (p === 'twilio') return 'twilio';
  if (p === 'aws_sns' || p === 'sns') return 'aws_sns';
  if (env.NODE_ENV === 'production' && (env.TWILIO_ACCOUNT_SID || env.AWS_SNS_REGION)) {
    return env.TWILIO_ACCOUNT_SID ? 'twilio' : 'aws_sns';
  }
  return 'mock';
}

// ─── Provider implementations ─────────────────────────────────────────────

async function sendTwilio(
  to: string,
  body: string,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const accountSid = env.TWILIO_ACCOUNT_SID;
  const authToken = env.TWILIO_AUTH_TOKEN;
  const from = env.TWILIO_FROM_NUMBER;
  if (!accountSid || !authToken || !from) {
    return { success: false, error: 'Twilio credentials not configured' };
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const auth = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`;
  const form = new URLSearchParams({ To: to, From: from, Body: body });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const data: any = await res.json();
    if (res.ok && data.status !== 'failed' && data.status !== 'undelivered') {
      return { success: true, messageId: data.sid };
    }
    return { success: false, error: data.message || data.error_message || `Twilio ${res.status}` };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

async function sendAwsSns(
  to: string,
  body: string,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const region = env.AWS_SNS_REGION || env.AWS_REGION;
  const accessKey = env.AWS_ACCESS_KEY_ID;
  const secretKey = env.AWS_SECRET_ACCESS_KEY;
  if (!region || !accessKey || !secretKey) {
    return { success: false, error: 'AWS SNS credentials not configured' };
  }
  // Use @aws-sdk/client-sns if available; otherwise fall back to signed HTTPS call
  try {
    // Dynamic import so optional peer dependency works
    const { SNSClient, PublishCommand } = await import('@aws-sdk/client-sns');
    const client = new SNSClient({ region, credentials: { accessKeyId: accessKey, secretAccessKey: secretKey } });
    const cmd = new PublishCommand({ PhoneNumber: to, Message: body });
    const out = await client.send(cmd);
    return { success: true, messageId: out.MessageId };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ─── Public API ───────────────────────────────────────────────────────────

export const SmsService = {
  OTP_LENGTH,
  OTP_TTL_SECONDS,

  provider(): SmsProvider {
    return getSmsProvider();
  },

  normalizePhone,

  // ── Rate limiting ──────────────────────────────────────────────────────

  async checkRateLimits(userId: string, phone: string): Promise<{
    allowed: boolean;
    reason?: string;
  }> {
    const perMinute = await RateLimiterService.check(
      `mfa:sms:user:${userId}`,
      SMS_RATE_WINDOW_MS,
      SMS_RATE_MAX,
    );
    if (!perMinute.allowed) {
      return { allowed: false, reason: 'Rate limit exceeded: please wait a minute before requesting another code' };
    }
    const perNumber = await RateLimiterService.check(
      `mfa:sms:phone:${phone}`,
      SMS_RATE_WINDOW_MS,
      SMS_RATE_MAX,
    );
    if (!perNumber.allowed) {
      return { allowed: false, reason: 'Rate limit exceeded for this phone number' };
    }
    const perDay = await RateLimiterService.check(
      `mfa:sms:phone:daily:${phone}`,
      SMS_DAILY_WINDOW_MS,
      SMS_DAILY_MAX,
    );
    if (!perDay.allowed) {
      return { allowed: false, reason: 'Daily SMS limit reached for this phone number' };
    }
    return { allowed: true };
  },

  // ── Send SMS ───────────────────────────────────────────────────────────

  async send(to: string, body: string): Promise<SendSmsResult> {
    const provider = getSmsProvider();
    const normalized = normalizePhone(to);
    if (!normalized || normalized.length < 8) {
      return { success: false, error: 'Invalid phone number' };
    }
    if (provider === 'twilio') {
      const r = await sendTwilio(normalized, body);
      return { ...r, provider: 'twilio' };
    }
    if (provider === 'aws_sns') {
      const r = await sendAwsSns(normalized, body);
      return { ...r, provider: 'aws_sns' };
    }
    // Mock: log and succeed
    logger.info('SMS (MOCK provider)', { to: normalized, body });
    return { success: true, provider: 'mock', messageId: 'mock-' + crypto.randomBytes(8).toString('hex') };
  },

  // ── OTP generation & storage ───────────────────────────────────────────

  generateOtp(): GenerateOtpResult {
    return {
      code: generateNumericOtp(),
      expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000),
    };
  },

  async storeOtp(params: {
    userId: string;
    method: 'sms' | 'email';
    code: string;
    expiresAt: Date;
    phoneOrEmail: string;
  }): Promise<void> {
    const hash = bcrypt.hashSync(params.code, bcrypt.genSaltSync(10));
    await pool.query(
      `INSERT INTO mfa_otp_codes (user_id, code_hash, method, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [params.userId, hash, params.method, params.expiresAt],
    );
  },

  async verifyAndConsumeOtp(params: {
    userId: string;
    method: 'sms' | 'email';
    code: string;
  }): Promise<{ valid: boolean; reason?: string }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{
        id: string;
        code_hash: string;
        used: boolean;
        expires_at: Date;
      }>(
        `SELECT id, code_hash, used, expires_at FROM mfa_otp_codes
         WHERE user_id = $1 AND method = $2 AND used = FALSE AND expires_at > NOW()
         ORDER BY created_at DESC
         LIMIT 5
         FOR UPDATE SKIP LOCKED`,
        [params.userId, params.method],
      );
      if (!rows.length) {
        await client.query('COMMIT');
        return { valid: false, reason: 'No valid codes found' };
      }
      for (const row of rows) {
        if (bcrypt.compareSync(params.code, row.code_hash)) {
          await client.query(`UPDATE mfa_otp_codes SET used = TRUE WHERE id = $1`, [row.id]);
          await client.query('COMMIT');
          return { valid: true };
        }
      }
      await client.query('COMMIT');
      return { valid: false, reason: 'Invalid code' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  async cleanupExpiredOtps(): Promise<number> {
    const { rowCount } = await pool.query(
      `DELETE FROM mfa_otp_codes WHERE expires_at < NOW() - INTERVAL '1 hour'`,
    );
    return rowCount ?? 0;
  },
};
