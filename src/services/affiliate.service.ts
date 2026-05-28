import pool from "../config/database";
import { CacheService } from "./cache.service";
import { logger } from "../utils/logger.utils";
import { createError } from "../middleware/errorHandler";
import {
  AffiliateProfile,
  RewardTier,
  RewardPayout,
  AffiliateDashboard,
  CreateAffiliateData,
  ProcessPayoutData
} from "../models/referral.model";

/**
 * Affiliate Service
 * Manages affiliate program, tiers, and payouts
 */
export const AffiliateService = {
  /**
   * Create affiliate profile
   */
  async createAffiliateProfile(data: CreateAffiliateData): Promise<AffiliateProfile> {
    try {
      // Check if profile already exists
      const existing = await this.getAffiliateProfile(data.userId);
      if (existing) {
        throw createError("Affiliate profile already exists", 409);
      }

      const { rows } = await pool.query(
        `INSERT INTO affiliate_profiles 
         (user_id, stellar_address, payment_schedule, minimum_payout, status)
         VALUES ($1, $2, $3, $4, 'pending')
         RETURNING *`,
        [
          data.userId,
          data.stellarAddress || null,
          data.paymentSchedule || 'monthly',
          data.minimumPayout || 10.00
        ]
      );

      logger.info("Affiliate profile created", {
        userId: data.userId,
        profileId: rows[0].id
      });

      return this.transformAffiliateProfile(rows[0]);
    } catch (error) {
      logger.error("Failed to create affiliate profile", {
        userId: data.userId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Get affiliate profile
   */
  async getAffiliateProfile(userId: string): Promise<AffiliateProfile | null> {
    try {
      const cacheKey = `affiliate:profile:${userId}`;
      const cached = await CacheService.get<AffiliateProfile>(cacheKey);
      if (cached) {
        return cached;
      }

      const { rows } = await pool.query(
        `SELECT ap.*, rt.name as tier_name, rt.tier_level, rt.reward_multiplier,
                u.first_name, u.last_name, u.email
         FROM affiliate_profiles ap
         LEFT JOIN reward_tiers rt ON ap.tier_id = rt.id
         JOIN users u ON ap.user_id = u.id
         WHERE ap.user_id = $1`,
        [userId]
      );

      if (rows.length === 0) {
        return null;
      }

      const profile = this.transformAffiliateProfile(rows[0]);

      // Cache for 5 minutes
      await CacheService.set(cacheKey, profile, 300);

      return profile;
    } catch (error) {
      logger.error("Failed to get affiliate profile", {
        userId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Update affiliate profile
   */
  async updateAffiliateProfile(
    userId: string,
    updates: Partial<AffiliateProfile>
  ): Promise<AffiliateProfile> {
    try {
      const existing = await this.getAffiliateProfile(userId);
      if (!existing) {
        throw createError("Affiliate profile not found", 404);
      }

      const setClauses: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (updates.status) {
        setClauses.push(`status = $${paramIndex++}`);
        values.push(updates.status);
      }

      if (updates.stellarAddress !== undefined) {
        setClauses.push(`stellar_address = $${paramIndex++}`);
        values.push(updates.stellarAddress);
      }

      if (updates.paymentSchedule) {
        setClauses.push(`payment_schedule = $${paramIndex++}`);
        values.push(updates.paymentSchedule);
      }

      if (updates.minimumPayout !== undefined) {
        setClauses.push(`minimum_payout = $${paramIndex++}`);
        values.push(updates.minimumPayout);
      }

      setClauses.push('updated_at = CURRENT_TIMESTAMP');
      values.push(userId);

      const { rows } = await pool.query(
        `UPDATE affiliate_profiles 
         SET ${setClauses.join(', ')}
         WHERE user_id = $${paramIndex}
         RETURNING *`,
        values
      );

      // Invalidate cache
      await CacheService.del(`affiliate:profile:${userId}`);
      await CacheService.del(`affiliate:dashboard:${userId}`);

      logger.info("Affiliate profile updated", { userId, updates });

      return this.transformAffiliateProfile(rows[0]);
    } catch (error) {
      logger.error("Failed to update affiliate profile", {
        userId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Approve affiliate profile
   */
  async approveAffiliateProfile(userId: string, approvedBy: string): Promise<void> {
    try {
      await pool.query(
        `UPDATE affiliate_profiles 
         SET status = 'active', approved_at = CURRENT_TIMESTAMP, approved_by = $1
         WHERE user_id = $2`,
        [approvedBy, userId]
      );

      // Invalidate cache
      await CacheService.del(`affiliate:profile:${userId}`);

      logger.info("Affiliate profile approved", { userId, approvedBy });
    } catch (error) {
      logger.error("Failed to approve affiliate profile", {
        userId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Get affiliate dashboard
   */
  async getAffiliateDashboard(userId: string): Promise<AffiliateDashboard> {
    try {
      const cacheKey = `affiliate:dashboard:${userId}`;
      const cached = await CacheService.get<AffiliateDashboard>(cacheKey);
      if (cached) {
        return cached;
      }

      const profile = await this.getAffiliateProfile(userId);
      if (!profile) {
        throw createError("Affiliate profile not found", 404);
      }

      // Get recent referrals
      const { rows: referralRows } = await pool.query(
        `SELECT r.*, u.first_name, u.last_name, u.email
         FROM referrals r
         LEFT JOIN users u ON r.referred_user_id = u.id
         WHERE r.referrer_id = $1
         ORDER BY r.created_at DESC
         LIMIT 10`,
        [userId]
      );

      // Get recent payouts
      const { rows: payoutRows } = await pool.query(
        `SELECT * FROM reward_payouts
         WHERE affiliate_id = $1
         ORDER BY created_at DESC
         LIMIT 10`,
        [profile.id]
      );

      // Get current tier
      const tier = await this.getRewardTier(profile.tierId!);

      // Get next tier
      const nextTier = await this.getNextTier(profile.successfulReferrals);
      const referralsToNextTier = nextTier 
        ? nextTier.minReferrals - profile.successfulReferrals 
        : 0;

      // Calculate next payout date
      const nextPayout = this.calculateNextPayoutDate(profile.paymentSchedule);

      const dashboard: AffiliateDashboard = {
        profile,
        stats: {
          totalReferrals: profile.totalReferrals,
          successfulReferrals: profile.successfulReferrals,
          pendingReferrals: profile.totalReferrals - profile.successfulReferrals,
          conversionRate: profile.conversionRate,
          totalEarnings: profile.totalEarnings,
          pendingEarnings: profile.pendingEarnings,
          paidEarnings: profile.paidEarnings,
          nextPayout,
          nextPayoutAmount: profile.pendingEarnings >= profile.minimumPayout 
            ? profile.pendingEarnings 
            : undefined
        },
        recentReferrals: referralRows.map(row => ({
          id: row.id,
          referrerId: row.referrer_id,
          referralCodeId: row.referral_code_id,
          referredUserId: row.referred_user_id,
          referredEmail: row.referred_email,
          status: row.status,
          conversionType: row.conversion_type,
          rewardAmount: parseFloat(row.reward_amount) || 0,
          rewardCurrency: row.reward_currency,
          rewardPaid: row.reward_paid,
          createdAt: row.created_at,
          metadata: row.metadata || {},
          referredUser: row.first_name ? {
            id: row.referred_user_id,
            firstName: row.first_name,
            lastName: row.last_name,
            email: row.email
          } : undefined
        })),
        recentPayouts: payoutRows.map(row => this.transformRewardPayout(row)),
        tier: tier!,
        nextTier,
        referralsToNextTier
      };

      // Cache for 5 minutes
      await CacheService.set(cacheKey, dashboard, 300);

      return dashboard;
    } catch (error) {
      logger.error("Failed to get affiliate dashboard", {
        userId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Process payout
   */
  async processPayout(data: ProcessPayoutData): Promise<RewardPayout> {
    try {
      const { rows: profileRows } = await pool.query(
        'SELECT * FROM affiliate_profiles WHERE id = $1',
        [data.affiliateId]
      );

      if (profileRows.length === 0) {
        throw createError("Affiliate profile not found", 404);
      }

      const profile = profileRows[0];

      // Check minimum payout
      if (data.amount < profile.minimum_payout) {
        throw createError(`Minimum payout is ${profile.minimum_payout} XLM`, 400);
      }

      // Create payout record
      const { rows } = await pool.query(
        `INSERT INTO reward_payouts 
         (affiliate_id, payout_type, amount, currency, status, payment_method, stellar_address, metadata)
         VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7)
         RETURNING *`,
        [
          data.affiliateId,
          data.payoutType,
          data.amount,
          'XLM',
          profile.payment_method,
          profile.stellar_address,
          JSON.stringify(data.metadata || {})
        ]
      );

      logger.info("Payout created", {
        payoutId: rows[0].id,
        affiliateId: data.affiliateId,
        amount: data.amount
      });

      // In production, this would integrate with Stellar payment system
      // For now, we'll simulate the process
      this.simulatePayout(rows[0].id).catch(err => {
        logger.error("Payout simulation failed", { error: err });
      });

      return this.transformRewardPayout(rows[0]);
    } catch (error) {
      logger.error("Failed to process payout", {
        affiliateId: data.affiliateId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Get reward tiers
   */
  async getRewardTiers(): Promise<RewardTier[]> {
    try {
      const cacheKey = 'affiliate:tiers';
      const cached = await CacheService.get<RewardTier[]>(cacheKey);
      if (cached) {
        return cached;
      }

      const { rows } = await pool.query(
        'SELECT * FROM reward_tiers WHERE is_active = true ORDER BY tier_level'
      );

      const tiers = rows.map(row => this.transformRewardTier(row));

      // Cache for 1 hour
      await CacheService.set(cacheKey, tiers, 3600);

      return tiers;
    } catch (error) {
      logger.error("Failed to get reward tiers", {
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Get reward tier by ID
   */
  async getRewardTier(tierId: string): Promise<RewardTier | null> {
    try {
      const { rows } = await pool.query(
        'SELECT * FROM reward_tiers WHERE id = $1',
        [tierId]
      );

      if (rows.length === 0) {
        return null;
      }

      return this.transformRewardTier(rows[0]);
    } catch (error) {
      logger.error("Failed to get reward tier", {
        tierId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Get next tier for affiliate
   */
  async getNextTier(currentReferrals: number): Promise<RewardTier | null> {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM reward_tiers 
         WHERE is_active = true AND min_referrals > $1
         ORDER BY tier_level ASC
         LIMIT 1`,
        [currentReferrals]
      );

      if (rows.length === 0) {
        return null;
      }

      return this.transformRewardTier(rows[0]);
    } catch (error) {
      logger.error("Failed to get next tier", {
        currentReferrals,
        error: error instanceof Error ? error.message : error
      });
      return null;
    }
  },

  // Helper methods
  private calculateNextPayoutDate(schedule: string): Date {
    const now = new Date();
    const nextPayout = new Date(now);

    switch (schedule) {
      case 'weekly':
        nextPayout.setDate(now.getDate() + (7 - now.getDay()));
        break;
      case 'biweekly':
        nextPayout.setDate(now.getDate() + (14 - (now.getDate() % 14)));
        break;
      case 'monthly':
        nextPayout.setMonth(now.getMonth() + 1, 1);
        break;
      default:
        nextPayout.setMonth(now.getMonth() + 1, 1);
    }

    return nextPayout;
  },

  private async simulatePayout(payoutId: string): Promise<void> {
    try {
      // Simulate processing time
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Update to processing
      await pool.query(
        `UPDATE reward_payouts 
         SET status = 'processing', processed_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [payoutId]
      );

      // Simulate more processing
      await new Promise(resolve => setTimeout(resolve, 10000));

      // Complete with transaction hash (simulated)
      const txHash = `STELLAR_TX_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      await pool.query(
        `UPDATE reward_payouts 
         SET status = 'completed', 
             transaction_hash = $1,
             completed_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [txHash, payoutId]
      );

      logger.info("Payout completed (simulated)", { payoutId, txHash });
    } catch (error) {
      logger.error("Payout simulation failed", {
        payoutId,
        error: error instanceof Error ? error.message : error
      });
    }
  },

  private transformAffiliateProfile(row: any): AffiliateProfile {
    return {
      id: row.id,
      userId: row.user_id,
      status: row.status,
      tierId: row.tier_id,
      totalReferrals: row.total_referrals,
      successfulReferrals: row.successful_referrals,
      totalEarnings: parseFloat(row.total_earnings),
      totalEarningsCurrency: row.total_earnings_currency,
      pendingEarnings: parseFloat(row.pending_earnings),
      paidEarnings: parseFloat(row.paid_earnings),
      conversionRate: parseFloat(row.conversion_rate),
      paymentMethod: row.payment_method,
      stellarAddress: row.stellar_address,
      paymentSchedule: row.payment_schedule,
      minimumPayout: parseFloat(row.minimum_payout),
      approvedAt: row.approved_at,
      approvedBy: row.approved_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      tier: row.tier_name ? {
        id: row.tier_id,
        name: row.tier_name,
        tierLevel: row.tier_level,
        rewardMultiplier: parseFloat(row.reward_multiplier)
      } as any : undefined,
      user: row.first_name ? {
        id: row.user_id,
        firstName: row.first_name,
        lastName: row.last_name,
        email: row.email
      } : undefined
    };
  },

  private transformRewardTier(row: any): RewardTier {
    return {
      id: row.id,
      name: row.name,
      tierLevel: row.tier_level,
      minReferrals: row.min_referrals,
      maxReferrals: row.max_referrals,
      rewardMultiplier: parseFloat(row.reward_multiplier),
      bonusAmount: parseFloat(row.bonus_amount),
      bonusCurrency: row.bonus_currency,
      perks: row.perks || [],
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  },

  private transformRewardPayout(row: any): RewardPayout {
    return {
      id: row.id,
      affiliateId: row.affiliate_id,
      payoutType: row.payout_type,
      amount: parseFloat(row.amount),
      currency: row.currency,
      status: row.status,
      paymentMethod: row.payment_method,
      stellarAddress: row.stellar_address,
      transactionHash: row.transaction_hash,
      processedAt: row.processed_at,
      completedAt: row.completed_at,
      failedReason: row.failed_reason,
      metadata: row.metadata || {},
      createdAt: row.created_at
    };
  }
};
