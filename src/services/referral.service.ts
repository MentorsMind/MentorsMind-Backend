import pool from "../config/database";
import { CacheService } from "./cache.service";
import { logger } from "../utils/logger.utils";
import { createError } from "../middleware/errorHandler";
import crypto from "crypto";
import {
  ReferralCode,
  Referral,
  CreateReferralCodeData,
  CreateReferralData,
  UpdateReferralData,
  ReferralStats
} from "../models/referral.model";

/**
 * Referral Service
 * Manages referral codes, tracking, and rewards
 */
export const ReferralService = {
  /**
   * Generate unique referral code
   */
  generateReferralCode(userId: string, length: number = 8): string {
    const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excluding similar characters
    const hash = crypto.createHash('sha256').update(userId + Date.now()).digest('hex');
    let code = '';
    
    for (let i = 0; i < length; i++) {
      const index = parseInt(hash.substr(i * 2, 2), 16) % characters.length;
      code += characters[index];
    }
    
    return code;
  },

  /**
   * Create referral code for user
   */
  async createReferralCode(data: CreateReferralCodeData): Promise<ReferralCode> {
    try {
      // Check if user already has an active personal code
      if (data.codeType === 'personal' || !data.codeType) {
        const { rows: existingRows } = await pool.query(
          `SELECT id FROM referral_codes 
           WHERE user_id = $1 AND code_type = 'personal' AND is_active = true`,
          [data.userId]
        );

        if (existingRows.length > 0) {
          throw createError("User already has an active referral code", 409);
        }
      }

      // Generate or use custom code
      let code = data.customCode || this.generateReferralCode(data.userId);
      
      // Ensure code is unique
      let attempts = 0;
      while (attempts < 5) {
        const { rows: codeCheck } = await pool.query(
          'SELECT id FROM referral_codes WHERE code = $1',
          [code]
        );

        if (codeCheck.length === 0) break;
        
        code = this.generateReferralCode(data.userId);
        attempts++;
      }

      if (attempts === 5) {
        throw createError("Failed to generate unique referral code", 500);
      }

      const { rows } = await pool.query(
        `INSERT INTO referral_codes 
         (user_id, code, code_type, max_uses, expires_at, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          data.userId,
          code,
          data.codeType || 'personal',
          data.maxUses || null,
          data.expiresAt || null,
          JSON.stringify(data.metadata || {})
        ]
      );

      logger.info("Referral code created", {
        userId: data.userId,
        code,
        codeType: data.codeType
      });

      return this.transformReferralCode(rows[0]);
    } catch (error) {
      logger.error("Failed to create referral code", {
        userId: data.userId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Get user's referral codes
   */
  async getUserReferralCodes(userId: string): Promise<ReferralCode[]> {
    try {
      const cacheKey = `referral:codes:${userId}`;
      const cached = await CacheService.get<ReferralCode[]>(cacheKey);
      if (cached) {
        return cached;
      }

      const { rows } = await pool.query(
        `SELECT * FROM referral_codes 
         WHERE user_id = $1 AND is_active = true
         ORDER BY created_at DESC`,
        [userId]
      );

      const codes = rows.map(row => this.transformReferralCode(row));

      // Cache for 5 minutes
      await CacheService.set(cacheKey, codes, 300);

      return codes;
    } catch (error) {
      logger.error("Failed to get user referral codes", {
        userId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Get referral code by code string
   */
  async getReferralCodeByCode(code: string): Promise<ReferralCode | null> {
    try {
      const { rows } = await pool.query(
        'SELECT * FROM referral_codes WHERE code = $1 AND is_active = true',
        [code.toUpperCase()]
      );

      if (rows.length === 0) {
        return null;
      }

      const referralCode = this.transformReferralCode(rows[0]);

      // Check if expired
      if (referralCode.expiresAt && new Date(referralCode.expiresAt) < new Date()) {
        return null;
      }

      // Check if max uses reached
      if (referralCode.maxUses && referralCode.currentUses >= referralCode.maxUses) {
        return null;
      }

      return referralCode;
    } catch (error) {
      logger.error("Failed to get referral code", {
        code,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Create referral (track referral usage)
   */
  async createReferral(data: CreateReferralData): Promise<Referral> {
    try {
      // Get referral code
      const referralCode = await this.getReferralCodeByCode(data.referralCode);
      if (!referralCode) {
        throw createError("Invalid or expired referral code", 400);
      }

      // Create referral record
      const { rows } = await pool.query(
        `INSERT INTO referrals 
         (referrer_id, referral_code_id, referred_email, status, metadata)
         VALUES ($1, $2, $3, 'pending', $4)
         RETURNING *`,
        [
          referralCode.userId,
          referralCode.id,
          data.referredEmail || null,
          JSON.stringify(data.metadata || {})
        ]
      );

      // Increment code usage
      await pool.query(
        'UPDATE referral_codes SET current_uses = current_uses + 1 WHERE id = $1',
        [referralCode.id]
      );

      // Invalidate cache
      await CacheService.del(`referral:codes:${referralCode.userId}`);

      logger.info("Referral created", {
        referralId: rows[0].id,
        referrerId: referralCode.userId,
        code: data.referralCode
      });

      return this.transformReferral(rows[0]);
    } catch (error) {
      logger.error("Failed to create referral", {
        code: data.referralCode,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Update referral status
   */
  async updateReferral(
    referralId: string,
    updates: UpdateReferralData
  ): Promise<Referral> {
    try {
      const existing = await this.getReferralById(referralId);
      if (!existing) {
        throw createError("Referral not found", 404);
      }

      const setClauses: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (updates.status) {
        setClauses.push(`status = $${paramIndex++}`);
        values.push(updates.status);

        // Set timestamps based on status
        if (updates.status === 'registered') {
          setClauses.push('registered_at = CURRENT_TIMESTAMP');
        } else if (updates.status === 'completed') {
          setClauses.push('completed_at = CURRENT_TIMESTAMP');
        }
      }

      if (updates.conversionType) {
        setClauses.push(`conversion_type = $${paramIndex++}`);
        values.push(updates.conversionType);
      }

      if (updates.referredUserId) {
        setClauses.push(`referred_user_id = $${paramIndex++}`);
        values.push(updates.referredUserId);
      }

      if (updates.metadata) {
        setClauses.push(`metadata = $${paramIndex++}`);
        values.push(JSON.stringify(updates.metadata));
      }

      values.push(referralId);

      const { rows } = await pool.query(
        `UPDATE referrals 
         SET ${setClauses.join(', ')}
         WHERE id = $${paramIndex}
         RETURNING *`,
        values
      );

      // If status changed to completed, calculate and assign reward
      if (updates.status === 'completed' && updates.conversionType) {
        await this.assignReward(referralId, updates.conversionType);
      }

      logger.info("Referral updated", {
        referralId,
        updates
      });

      return this.transformReferral(rows[0]);
    } catch (error) {
      logger.error("Failed to update referral", {
        referralId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Assign reward to referral
   */
  async assignReward(referralId: string, conversionType: string): Promise<void> {
    try {
      // Get reward configuration
      const { rows: configRows } = await pool.query(
        'SELECT * FROM reward_configurations WHERE event_type = $1 AND is_active = true',
        [conversionType]
      );

      if (configRows.length === 0) {
        logger.warn("No reward configuration found", { conversionType });
        return;
      }

      const config = configRows[0];

      // Update referral with reward amount
      await pool.query(
        `UPDATE referrals 
         SET reward_amount = $1, reward_currency = $2
         WHERE id = $3`,
        [config.referrer_reward, config.reward_currency, referralId]
      );

      logger.info("Reward assigned to referral", {
        referralId,
        amount: config.referrer_reward,
        currency: config.reward_currency
      });
    } catch (error) {
      logger.error("Failed to assign reward", {
        referralId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Get referral by ID
   */
  async getReferralById(referralId: string): Promise<Referral | null> {
    try {
      const { rows } = await pool.query(
        `SELECT r.*, 
                u1.first_name as referrer_first_name, u1.last_name as referrer_last_name, u1.email as referrer_email,
                u2.first_name as referred_first_name, u2.last_name as referred_last_name, u2.email as referred_email
         FROM referrals r
         JOIN users u1 ON r.referrer_id = u1.id
         LEFT JOIN users u2 ON r.referred_user_id = u2.id
         WHERE r.id = $1`,
        [referralId]
      );

      if (rows.length === 0) {
        return null;
      }

      return this.transformReferral(rows[0]);
    } catch (error) {
      logger.error("Failed to get referral", {
        referralId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Get user's referrals
   */
  async getUserReferrals(
    userId: string,
    status?: Referral['status']
  ): Promise<Referral[]> {
    try {
      let query = `
        SELECT r.*, 
               u2.first_name as referred_first_name, u2.last_name as referred_last_name, u2.email as referred_email
        FROM referrals r
        LEFT JOIN users u2 ON r.referred_user_id = u2.id
        WHERE r.referrer_id = $1
      `;

      const params: any[] = [userId];

      if (status) {
        query += ' AND r.status = $2';
        params.push(status);
      }

      query += ' ORDER BY r.created_at DESC';

      const { rows } = await pool.query(query, params);

      return rows.map(row => this.transformReferral(row));
    } catch (error) {
      logger.error("Failed to get user referrals", {
        userId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Get referral statistics
   */
  async getReferralStats(userId?: string): Promise<ReferralStats> {
    try {
      const cacheKey = userId ? `referral:stats:${userId}` : 'referral:stats:global';
      const cached = await CacheService.get<ReferralStats>(cacheKey);
      if (cached) {
        return cached;
      }

      let whereClause = userId ? 'WHERE referrer_id = $1' : '';
      const params = userId ? [userId] : [];

      const { rows: statsRows } = await pool.query(
        `SELECT 
           COUNT(*) as total_referrals,
           COUNT(CASE WHEN status = 'completed' THEN 1 END) as successful_referrals,
           COUNT(CASE WHEN status IN ('pending', 'registered') THEN 1 END) as pending_referrals,
           COALESCE(SUM(CASE WHEN reward_paid THEN reward_amount ELSE 0 END), 0) as total_earnings,
           CASE 
             WHEN COUNT(*) > 0 THEN 
               COUNT(CASE WHEN status = 'completed' THEN 1 END) * 100.0 / COUNT(*)
             ELSE 0 
           END as conversion_rate
         FROM referrals ${whereClause}`,
        params
      );

      const stats = statsRows[0];

      // Get top referrers (if global stats)
      let topReferrers: any[] = [];
      if (!userId) {
        const { rows: topRows } = await pool.query(
          `SELECT r.referrer_id, u.first_name, u.last_name,
                  COUNT(*) as referrals,
                  COALESCE(SUM(r.reward_amount), 0) as earnings
           FROM referrals r
           JOIN users u ON r.referrer_id = u.id
           WHERE r.status = 'completed'
           GROUP BY r.referrer_id, u.first_name, u.last_name
           ORDER BY referrals DESC
           LIMIT 10`
        );

        topReferrers = topRows.map(row => ({
          userId: row.referrer_id,
          name: `${row.first_name} ${row.last_name}`,
          referrals: parseInt(row.referrals),
          earnings: parseFloat(row.earnings)
        }));
      }

      // Get recent activity (last 30 days)
      const { rows: activityRows } = await pool.query(
        `SELECT DATE(created_at) as date,
                COUNT(*) as referrals,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as conversions
         FROM referrals
         ${whereClause}
         ${whereClause ? 'AND' : 'WHERE'} created_at >= CURRENT_DATE - INTERVAL '30 days'
         GROUP BY DATE(created_at)
         ORDER BY date DESC`,
        params
      );

      const recentActivity = activityRows.map(row => ({
        date: row.date,
        referrals: parseInt(row.referrals),
        conversions: parseInt(row.conversions)
      }));

      const result: ReferralStats = {
        totalReferrals: parseInt(stats.total_referrals),
        successfulReferrals: parseInt(stats.successful_referrals),
        pendingReferrals: parseInt(stats.pending_referrals),
        totalEarnings: parseFloat(stats.total_earnings),
        conversionRate: parseFloat(stats.conversion_rate),
        topReferrers,
        recentActivity
      };

      // Cache for 10 minutes
      await CacheService.set(cacheKey, result, 600);

      return result;
    } catch (error) {
      logger.error("Failed to get referral stats", {
        userId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  // Helper methods
  private transformReferralCode(row: any): ReferralCode {
    return {
      id: row.id,
      userId: row.user_id,
      code: row.code,
      codeType: row.code_type,
      isActive: row.is_active,
      maxUses: row.max_uses,
      currentUses: row.current_uses,
      expiresAt: row.expires_at,
      metadata: row.metadata || {},
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  },

  private transformReferral(row: any): Referral {
    return {
      id: row.id,
      referrerId: row.referrer_id,
      referralCodeId: row.referral_code_id,
      referredUserId: row.referred_user_id,
      referredEmail: row.referred_email,
      status: row.status,
      conversionType: row.conversion_type,
      rewardAmount: parseFloat(row.reward_amount) || 0,
      rewardCurrency: row.reward_currency || 'XLM',
      rewardPaid: row.reward_paid,
      rewardPaidAt: row.reward_paid_at,
      rewardTransactionHash: row.reward_transaction_hash,
      createdAt: row.created_at,
      registeredAt: row.registered_at,
      completedAt: row.completed_at,
      expiresAt: row.expires_at,
      metadata: row.metadata || {},
      referrer: row.referrer_first_name ? {
        id: row.referrer_id,
        firstName: row.referrer_first_name,
        lastName: row.referrer_last_name,
        email: row.referrer_email
      } : undefined,
      referredUser: row.referred_first_name ? {
        id: row.referred_user_id,
        firstName: row.referred_first_name,
        lastName: row.referred_last_name,
        email: row.referred_email
      } : undefined
    };
  }
};
