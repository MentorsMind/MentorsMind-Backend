import pool from "../config/database";
import { CacheService } from "./cache.service";
import { logger } from "../utils/logger.utils";
import { createError } from "../middleware/errorHandler";
import { FraudDetectionService } from "./fraud-detection.service";
import { Queue } from "bullmq";
import { redisConnection, QUEUE_NAMES } from "../config/queue";
import crypto from "crypto";
import config from "../config";

/**
 * Enhanced Referral Service with Fraud Detection and Stellar Payouts
 * Implements complete referral reward system with 7-day hold and fraud prevention
 */

const REFERRAL_REWARD_XLM = parseFloat(config.referral?.rewardAmount || "5.0");
const REWARD_HOLD_DAYS = parseInt(config.referral?.holdDays || "7", 10);

export interface ReferralCode {
  id: string;
  ownerId: string;
  code: string;
  usesRemaining: number | null;
  currentUses: number;
  expiresAt: Date | null;
  isActive: boolean;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReferralEvent {
  id: string;
  eventType: string;
  referrerId: string;
  refereeId: string | null;
  referralCode: string;
  rewardAmount: number | null;
  rewardCurrency: string;
  rewardStatus: string | null;
  qualifyingBookingId: string | null;
  stellarTxHash: string | null;
  payoutScheduledAt: Date | null;
  payoutCompletedAt: Date | null;
  fraudFlags: string[];
  metadata: Record<string, any>;
  createdAt: Date;
}

export interface ReferralStats {
  totalEarnings: number;
  pendingRewards: number;
  paidRewards: number;
  totalReferrals: number;
  successfulReferrals: number;
  failedReferrals: number;
  averageReward: number;
}

// Initialize referral reward queue
const referralRewardQueue = new Queue(QUEUE_NAMES.REFERRAL_REWARD, {
  connection: redisConnection,
});

export const EnhancedReferralService = {
  /**
   * Generate unique 8-character alphanumeric referral code
   */
  generateReferralCode(): string {
    const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const randomBytes = crypto.randomBytes(8);
    let code = '';
    
    for (let i = 0; i < 8; i++) {
      const index = randomBytes[i] % characters.length;
      code += characters[index];
    }
    
    return code;
  },

  /**
   * Create or get referral code for user
   */
  async getOrCreateReferralCode(userId: string): Promise<ReferralCode> {
    try {
      // Check if user already has an active code
      const { rows: existing } = await pool.query(
        'SELECT * FROM referral_codes WHERE owner_id = $1 AND is_active = true LIMIT 1',
        [userId]
      );

      if (existing.length > 0) {
        return this.transformReferralCode(existing[0]);
      }

      // Generate unique code
      let code = this.generateReferralCode();
      let attempts = 0;
      
      while (attempts < 10) {
        const { rows: collision } = await pool.query(
          'SELECT id FROM referral_codes WHERE code = $1',
          [code]
        );
        
        if (collision.length === 0) break;
        code = this.generateReferralCode();
        attempts++;
      }

      if (attempts === 10) {
        throw createError('Failed to generate unique referral code', 500);
      }

      // Create code
      const { rows } = await pool.query(
        `INSERT INTO referral_codes (owner_id, code, is_active)
         VALUES ($1, $2, true)
         RETURNING *`,
        [userId, code]
      );

      // Log event
      await this.logReferralEvent({
        eventType: 'code_generated',
        referrerId: userId,
        referralCode: code,
        metadata: {}
      });

      logger.info('Referral code created', { userId, code });

      return this.transformReferralCode(rows[0]);
    } catch (error) {
      logger.error('Failed to create referral code', {
        userId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Apply referral code during user registration with fraud detection
   */
  async applyReferralCode(
    referralCode: string,
    refereeId: string,
    context: {
      refereeEmail: string;
      refereeIp?: string;
      deviceFingerprint?: string;
    }
  ): Promise<{ success: boolean; message: string; fraudFlags?: string[] }> {
    try {
      // Validate code exists and is active
      const { rows: codeRows } = await pool.query(
        'SELECT * FROM referral_codes WHERE code = $1 AND is_active = true',
        [referralCode.toUpperCase()]
      );

      if (codeRows.length === 0) {
        return { success: false, message: 'Invalid referral code' };
      }

      const code = codeRows[0];

      // Check expiration
      if (code.expires_at && new Date(code.expires_at) < new Date()) {
        return { success: false, message: 'Referral code has expired' };
      }

      // Check uses remaining
      if (code.uses_remaining !== null && code.uses_remaining <= 0) {
        return { success: false, message: 'Referral code has reached maximum uses' };
      }

      // Get referee's creation time
      const { rows: userRows } = await pool.query(
        'SELECT created_at FROM users WHERE id = $1',
        [refereeId]
      );

      // Run fraud detection
      const fraudCheck = await FraudDetectionService.checkReferralFraud({
        referrerId: code.owner_id,
        refereeId,
        refereeEmail: context.refereeEmail,
        refereeIp: context.refereeIp,
        refereeDeviceFingerprint: context.deviceFingerprint,
        refereeCreatedAt: userRows.length > 0 ? new Date(userRows[0].created_at) : new Date()
      });

      if (!fraudCheck.isValid) {
        // Log fraud detection
        await FraudDetectionService.logFraudEvent(
          code.owner_id,
          refereeId,
          fraudCheck.fraudFlags,
          fraudCheck.riskScore
        );

        logger.warn('Referral application rejected - fraud detected', {
          referralCode,
          refereeId,
          fraudFlags: fraudCheck.fraudFlags,
          riskScore: fraudCheck.riskScore
        });

        return {
          success: false,
          message: 'Referral cannot be applied due to suspicious activity',
          fraudFlags: fraudCheck.fraudFlags
        };
      }

      // Update referee's referred_by field
      await pool.query(
        'UPDATE users SET referred_by = $1 WHERE id = $2',
        [code.owner_id, refereeId]
      );

      // Increment code usage
      await pool.query(
        `UPDATE referral_codes 
         SET current_uses = current_uses + 1,
             uses_remaining = CASE 
               WHEN uses_remaining IS NOT NULL THEN uses_remaining - 1
               ELSE NULL
             END
         WHERE id = $1`,
        [code.id]
      );

      // Log successful application
      await this.logReferralEvent({
        eventType: 'code_applied',
        referrerId: code.owner_id,
        refereeId,
        referralCode: referralCode.toUpperCase(),
        metadata: {
          referee_email: context.refereeEmail,
          referee_ip: context.refereeIp,
          device_fingerprint: context.deviceFingerprint,
          fraud_flags: fraudCheck.fraudFlags,
          risk_score: fraudCheck.riskScore
        }
      });

      logger.info('Referral code applied successfully', {
        referralCode,
        referrerId: code.owner_id,
        refereeId
      });

      return { success: true, message: 'Referral code applied successfully' };
    } catch (error) {
      logger.error('Failed to apply referral code', {
        referralCode,
        refereeId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Process referral reward when referee completes first paid session
   * Called from booking completion hook
   */
  async processReferralReward(bookingId: string, refereeId: string): Promise<void> {
    try {
      // Check if this is referee's first completed booking
      const { rows: bookingCount } = await pool.query(
        `SELECT COUNT(*) as count
         FROM bookings
         WHERE (mentee_id = $1 OR mentor_id = $1)
           AND status = 'completed'`,
        [refereeId]
      );

      if (parseInt(bookingCount[0].count, 10) !== 1) {
        logger.debug('Not first booking - skipping referral reward', {
          bookingId,
          refereeId,
          completedBookings: bookingCount[0].count
        });
        return;
      }

      // Get referrer
      const { rows: referrerRows } = await pool.query(
        'SELECT referred_by FROM users WHERE id = $1',
        [refereeId]
      );

      if (referrerRows.length === 0 || !referrerRows[0].referred_by) {
        logger.debug('No referrer found for user', { refereeId });
        return;
      }

      const referrerId = referrerRows[0].referred_by;

      // Get referrer's Stellar public key
      const { rows: stellarRows } = await pool.query(
        'SELECT stellar_public_key FROM users WHERE id = $1',
        [referrerId]
      );

      if (stellarRows.length === 0 || !stellarRows[0].stellar_public_key) {
        logger.warn('Referrer has no Stellar wallet - cannot pay reward', {
          referrerId,
          refereeId
        });
        return;
      }

      const referrerStellarKey = stellarRows[0].stellar_public_key;

      // Check if reward already processed
      const { rows: existingReward } = await pool.query(
        `SELECT id FROM referral_events
         WHERE referrer_id = $1 
           AND referee_id = $2
           AND event_type IN ('reward_qualified', 'reward_held', 'reward_paid')
         LIMIT 1`,
        [referrerId, refereeId]
      );

      if (existingReward.length > 0) {
        logger.debug('Reward already processed', { referrerId, refereeId });
        return;
      }

      // Calculate payout schedule (7 days from now)
      const payoutDate = new Date();
      payoutDate.setDate(payoutDate.getDate() + REWARD_HOLD_DAYS);

      // Log reward qualification
      await this.logReferralEvent({
        eventType: 'reward_qualified',
        referrerId,
        refereeId,
        referralCode: 'SYSTEM',
        rewardAmount: REFERRAL_REWARD_XLM,
        rewardCurrency: 'XLM',
        rewardStatus: 'held',
        qualifyingBookingId: bookingId,
        payoutScheduledAt: payoutDate,
        metadata: {
          referrer_stellar_key: referrerStellarKey,
          qualifying_event: 'first_booking'
        }
      });

      // Queue payout job with 7-day delay
      await referralRewardQueue.add(
        'process-payout',
        {
          referrerId,
          refereeId,
          bookingId,
          rewardAmount: REFERRAL_REWARD_XLM,
          referrerStellarKey
        },
        {
          delay: REWARD_HOLD_DAYS * 24 * 60 * 60 * 1000, // Convert days to ms
          attempts: 5,
          backoff: {
            type: 'exponential',
            delay: 5000
          }
        }
      );

      logger.info('Referral reward queued for payout', {
        referrerId,
        refereeId,
        bookingId,
        rewardAmount: REFERRAL_REWARD_XLM,
        payoutDate
      });
    } catch (error) {
      logger.error('Failed to process referral reward', {
        bookingId,
        refereeId,
        error: error instanceof Error ? error.message : error
      });
    }
  },

  /**
   * Get referral statistics for user
   */
  async getReferralStats(userId: string): Promise<ReferralStats> {
    try {
      const cacheKey = `referral:stats:${userId}`;
      const cached = await CacheService.get<ReferralStats>(cacheKey);
      if (cached) return cached;

      const { rows } = await pool.query(
        `SELECT 
           COUNT(DISTINCT referee_id) as total_referrals,
           COUNT(CASE WHEN reward_status = 'paid' THEN 1 END) as successful_referrals,
           COUNT(CASE WHEN reward_status = 'rejected' THEN 1 END) as failed_referrals,
           COALESCE(SUM(CASE WHEN reward_status = 'paid' THEN reward_amount ELSE 0 END), 0) as paid_rewards,
           COALESCE(SUM(CASE WHEN reward_status = 'held' THEN reward_amount ELSE 0 END), 0) as pending_rewards,
           COALESCE(SUM(CASE WHEN reward_status IN ('paid', 'held') THEN reward_amount ELSE 0 END), 0) as total_earnings,
           COALESCE(AVG(CASE WHEN reward_status = 'paid' THEN reward_amount END), 0) as average_reward
         FROM referral_events
         WHERE referrer_id = $1
           AND event_type IN ('reward_qualified', 'reward_held', 'reward_paid')`,
        [userId]
      );

      const stats: ReferralStats = {
        totalEarnings: parseFloat(rows[0].total_earnings) || 0,
        pendingRewards: parseFloat(rows[0].pending_rewards) || 0,
        paidRewards: parseFloat(rows[0].paid_rewards) || 0,
        totalReferrals: parseInt(rows[0].total_referrals, 10) || 0,
        successfulReferrals: parseInt(rows[0].successful_referrals, 10) || 0,
        failedReferrals: parseInt(rows[0].failed_referrals, 10) || 0,
        averageReward: parseFloat(rows[0].average_reward) || 0
      };

      await CacheService.set(cacheKey, stats, 300); // 5 min cache

      return stats;
    } catch (error) {
      logger.error('Failed to get referral stats', {
        userId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Log referral event to audit trail
   */
  async logReferralEvent(event: {
    eventType: string;
    referrerId: string;
    refereeId?: string | null;
    referralCode: string;
    rewardAmount?: number;
    rewardCurrency?: string;
    rewardStatus?: string;
    qualifyingBookingId?: string;
    stellarTxHash?: string;
    payoutScheduledAt?: Date;
    payoutCompletedAt?: Date;
    fraudFlags?: string[];
    metadata: Record<string, any>;
  }): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO referral_events (
          event_type, referrer_id, referee_id, referral_code,
          reward_amount, reward_currency, reward_status,
          qualifying_booking_id, stellar_tx_hash,
          payout_scheduled_at, payout_completed_at,
          fraud_flags, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          event.eventType,
          event.referrerId,
          event.refereeId || null,
          event.referralCode,
          event.rewardAmount || null,
          event.rewardCurrency || 'XLM',
          event.rewardStatus || null,
          event.qualifyingBookingId || null,
          event.stellarTxHash || null,
          event.payoutScheduledAt || null,
          event.payoutCompletedAt || null,
          JSON.stringify(event.fraudFlags || []),
          JSON.stringify(event.metadata)
        ]
      );

      // Invalidate stats cache
      await CacheService.del(`referral:stats:${event.referrerId}`);
    } catch (error) {
      logger.error('Failed to log referral event', {
        event,
        error: error instanceof Error ? error.message : error
      });
    }
  },

  /**
   * Transform database row to ReferralCode
   */
  transformReferralCode(row: any): ReferralCode {
    return {
      id: row.id,
      ownerId: row.owner_id,
      code: row.code,
      usesRemaining: row.uses_remaining,
      currentUses: row.current_uses,
      expiresAt: row.expires_at,
      isActive: row.is_active,
      metadata: row.metadata || {},
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
};
