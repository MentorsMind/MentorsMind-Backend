/**
 * Login Attempts Service
 * Tracks failed login attempts per email in Redis with progressive lockout.
 *
 * Thresholds:
 *   3  attempts → captcha_required flag
 *   5  attempts → 15-minute lockout
 *   10 attempts → 1-hour lockout + email alert
 *   20 attempts → permanent lockout (requires admin unlock)
 */

import { logger } from '../utils/logger';
import { EmailService } from './email.service';

// ─── Constants ────────────────────────────────────────────────────────────────

const PREFIX = 'login_attempts:';
const PERMANENT_PREFIX = 'login_locked_permanent:';

export const THRESHOLDS = {
  CAPTCHA: 3,
  LOCK_15M: 5,
  LOCK_1H: 10,
  LOCK_PERMANENT: 20,
} as const;

const TTL = {
  LOCK_15M: 15 * 60,       // seconds
  LOCK_1H: 60 * 60,        // seconds
  COUNTER_MAX: 24 * 60 * 60, // keep counter for 24h max
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LockStatus {
  locked: boolean;
  permanent: boolean;
  attempts: number;
  captchaRequired: boolean;
  retryAfter?: number; // seconds until unlock
}

// ─── Redis client (lazy, same pattern as rate-limiter.service.ts) ─────────────

import { redis } from "../config/redis";


// ─── In-memory fallback ───────────────────────────────────────────────────────

interface MemEntry { count: number; lockedUntil?: number; permanent?: boolean }
const memStore = new Map<string, MemEntry>();

// ─── Service ──────────────────────────────────────────────────────────────────

export const LoginAttemptsService = {
  /**
   * Record a failed login attempt for an email.
   * Returns the updated LockStatus after recording.
   */
  async recordFailure(email: string, ipAddress: string | null, userEmail?: string): Promise<LockStatus> {
    const key = PREFIX + email.toLowerCase();
    const permKey = PERMANENT_PREFIX + email.toLowerCase();

    const client = redis;

    if (redis.status === 'ready') {
      // Check permanent lock first
      const isPermanent = await redis.exists(permKey);
      if (isPermanent) {
        const count = parseInt(await redis.get(key) ?? '20', 10);
        return { locked: true, permanent: true, attempts: count, captchaRequired: true };
      }

      // Increment counter with 24h TTL
      const pipeline = redis.pipeline();
      pipeline.incr(key);
      pipeline.expire(key, TTL.COUNTER_MAX);
      const results = await pipeline.exec();
      const attempts: number = results[0][1] as number;

      return this._applyThresholds(email, attempts, redis, permKey, key, ipAddress, userEmail);
    }

    // ── In-memory fallback ──
    const entry = memStore.get(key) ?? { count: 0 };
    if (entry.permanent) {
      return { locked: true, permanent: true, attempts: entry.count, captchaRequired: true };
    }
    entry.count += 1;
    memStore.set(key, entry);
    return this._applyThresholdsMemory(email, entry, key, ipAddress, userEmail);
  },

  /**
   * Check the current lock status for an email without recording a new attempt.
   */
  async getStatus(email: string): Promise<LockStatus> {
    const key = PREFIX + email.toLowerCase();
    const permKey = PERMANENT_PREFIX + email.toLowerCase();

    if (redis.status === 'ready') {
      const [isPermanent, rawCount, ttl] = await Promise.all([
        redis.exists(permKey),
        redis.get(key),
        redis.ttl(key),
      ]);

      const attempts = parseInt(rawCount ?? '0', 10);

      if (isPermanent) {
        return { locked: true, permanent: true, attempts, captchaRequired: true };
      }

      if (attempts >= THRESHOLDS.LOCK_1H) {
        const retryAfter = ttl > 0 ? ttl : TTL.LOCK_1H;
        return { locked: true, permanent: false, attempts, captchaRequired: true, retryAfter };
      }

      if (attempts >= THRESHOLDS.LOCK_15M) {
        const retryAfter = ttl > 0 ? ttl : TTL.LOCK_15M;
        return { locked: true, permanent: false, attempts, captchaRequired: true, retryAfter };
      }

      return {
        locked: false,
        permanent: false,
        attempts,
        captchaRequired: attempts >= THRESHOLDS.CAPTCHA,
      };
    }

    // ── In-memory fallback ──
    const entry = memStore.get(key);
    if (!entry) return { locked: false, permanent: false, attempts: 0, captchaRequired: false };

    if (entry.permanent) {
      return { locked: true, permanent: true, attempts: entry.count, captchaRequired: true };
    }

    const now = Date.now();
    if (entry.lockedUntil && entry.lockedUntil > now) {
      return {
        locked: true,
        permanent: false,
        attempts: entry.count,
        captchaRequired: true,
        retryAfter: Math.ceil((entry.lockedUntil - now) / 1000),
      };
    }

    return {
      locked: false,
      permanent: false,
      attempts: entry.count,
      captchaRequired: entry.count >= THRESHOLDS.CAPTCHA,
    };
  },

  /**
   * Reset the failed attempt counter on successful login.
   */
  async resetAttempts(email: string): Promise<void> {
    const key = PREFIX + email.toLowerCase();
    if (redis.status === 'ready') {
      await redis.del(key);
    } else {
      const entry = memStore.get(key);
      if (entry) {
        entry.count = 0;
        entry.lockedUntil = undefined;
        memStore.set(key, entry);
      }
    }
  },

  /**
   * Admin: permanently unlock an account (clear both counter and permanent lock).
   */
  async adminUnlock(email: string): Promise<void> {
    const key = PREFIX + email.toLowerCase();
    const permKey = PERMANENT_PREFIX + email.toLowerCase();
    const client = redis;

    if (redis && redisAvailable) {
      await redis.del(key, permKey);
    } else {
      memStore.delete(key);
    }
  },

  // ─── Private helpers ────────────────────────────────────────────────────────

  async _applyThresholds(
    email: string,
    attempts: number,
    redis: any,
    permKey: string,
    key: string,
    ipAddress: string | null,
    userEmail?: string,
  ): Promise<LockStatus> {
    if (attempts >= THRESHOLDS.LOCK_PERMANENT) {
      // Permanent lock — set a sentinel key with no expiry
      await redis.set(permKey, '1');
      logger.warn('Account permanently locked', { email, attempts, ipAddress });
      this._sendLockoutEmail(userEmail ?? email, 'permanent', ipAddress).catch(() => {});
      return { locked: true, permanent: true, attempts, captchaRequired: true };
    }

    if (attempts >= THRESHOLDS.LOCK_1H) {
      await redis.expire(key, TTL.LOCK_1H);
      if (attempts === THRESHOLDS.LOCK_1H) {
        logger.warn('Account locked for 1 hour', { email, attempts, ipAddress });
        this._sendLockoutEmail(userEmail ?? email, '1h', ipAddress).catch(() => {});
      }
      return { locked: true, permanent: false, attempts, captchaRequired: true, retryAfter: TTL.LOCK_1H };
    }

    if (attempts >= THRESHOLDS.LOCK_15M) {
      await redis.expire(key, TTL.LOCK_15M);
      logger.warn('Account locked for 15 minutes', { email, attempts, ipAddress });
      return { locked: true, permanent: false, attempts, captchaRequired: true, retryAfter: TTL.LOCK_15M };
    }

    return {
      locked: false,
      permanent: false,
      attempts,
      captchaRequired: attempts >= THRESHOLDS.CAPTCHA,
    };
  },

  async _applyThresholdsMemory(
    email: string,
    entry: MemEntry,
    key: string,
    ipAddress: string | null,
    userEmail?: string,
  ): Promise<LockStatus> {
    const now = Date.now();

    if (entry.count >= THRESHOLDS.LOCK_PERMANENT) {
      entry.permanent = true;
      memStore.set(key, entry);
      this._sendLockoutEmail(userEmail ?? email, 'permanent', ipAddress).catch(() => {});
      return { locked: true, permanent: true, attempts: entry.count, captchaRequired: true };
    }

    if (entry.count >= THRESHOLDS.LOCK_1H) {
      entry.lockedUntil = now + TTL.LOCK_1H * 1000;
      memStore.set(key, entry);
      if (entry.count === THRESHOLDS.LOCK_1H) {
        this._sendLockoutEmail(userEmail ?? email, '1h', ipAddress).catch(() => {});
      }
      return { locked: true, permanent: false, attempts: entry.count, captchaRequired: true, retryAfter: TTL.LOCK_1H };
    }

    if (entry.count >= THRESHOLDS.LOCK_15M) {
      entry.lockedUntil = now + TTL.LOCK_15M * 1000;
      memStore.set(key, entry);
      return { locked: true, permanent: false, attempts: entry.count, captchaRequired: true, retryAfter: TTL.LOCK_15M };
    }

    return {
      locked: false,
      permanent: false,
      attempts: entry.count,
      captchaRequired: entry.count >= THRESHOLDS.CAPTCHA,
    };
  },

  async _sendLockoutEmail(email: string, type: '1h' | 'permanent', ipAddress: string | null): Promise<void> {
    const emailService = new EmailService();
    const subject = type === 'permanent'
      ? 'Your account has been permanently locked'
      : 'Your account has been temporarily locked';

    const body = type === 'permanent'
      ? `Your account has been permanently locked due to too many failed login attempts from IP ${ipAddress ?? 'unknown'}. Please contact support to unlock your account.`
      : `Your account has been locked for 1 hour due to repeated failed login attempts from IP ${ipAddress ?? 'unknown'}. If this wasn't you, please reset your password immediately.`;

    await emailService.sendEmail({
      to: [email],
      subject,
      htmlContent: `<p>${body}</p>`,
      textContent: body,
    });
  },
};
