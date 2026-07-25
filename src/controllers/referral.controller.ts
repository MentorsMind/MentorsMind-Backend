import { Request, Response, NextFunction } from "express";
import { EnhancedReferralService } from "../services/referral-enhanced.service";
import { logger } from "../utils/logger.utils";
import { createError } from "../middleware/errorHandler";
import pool from "../config/database";

/**
 * Referral Controller
 * Handles HTTP endpoints for referral code management and statistics
 */

export const ReferralController = {
  /**
   * GET /api/v1/referrals/code
   * Get or create referral code for authenticated user
   */
  async getMyReferralCode(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw createError("Authentication required", 401);
      }

      const code = await EnhancedReferralService.getOrCreateReferralCode(userId);

      res.json({
        success: true,
        data: {
          code: code.code,
          usesRemaining: code.usesRemaining,
          currentUses: code.currentUses,
          expiresAt: code.expiresAt,
          shareUrl: `${process.env.FRONTEND_URL}/signup?ref=${code.code}`
        }
      });
    } catch (error) {
      logger.error("Failed to get referral code", {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  },

  /**
   * POST /api/v1/referrals/apply
   * Apply referral code during signup
   */
  async applyReferralCode(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw createError("Authentication required", 401);
      }

      const { referralCode } = req.body;
      if (!referralCode || typeof referralCode !== 'string') {
        throw createError("Referral code is required", 400);
      }

      const { rows: userRows } = await pool.query(
        'SELECT email FROM users WHERE id = $1',
        [userId]
      );

      if (userRows.length === 0) {
        throw createError("User not found", 404);
      }

      const result = await EnhancedReferralService.applyReferralCode(
        referralCode,
        userId,
        {
          refereeEmail: userRows[0].email,
          refereeIp: req.ip || req.headers['x-forwarded-for'] as string,
          deviceFingerprint: req.headers['x-device-fingerprint'] as string
        }
      );

      if (!result.success) {
        res.status(400).json({
          success: false,
          message: result.message,
          fraudFlags: result.fraudFlags
        });
        return;
      }

      res.json({
        success: true,
        message: result.message
      });
    } catch (error) {
      logger.error("Failed to apply referral code", {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  },

  /**
   * GET /api/v1/referrals/stats
   * Get referral statistics for authenticated user
   */
  async getReferralStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw createError("Authentication required", 401);
      }

      const stats = await EnhancedReferralService.getReferralStats(userId);

      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      logger.error("Failed to get referral stats", {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  },

  /**
   * GET /api/v1/referrals/history
   * Get referral event history for authenticated user
   */
  async getReferralHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw createError("Authentication required", 401);
      }

      const { page = 1, limit = 20 } = req.query;
      const offset = (Number(page) - 1) * Number(limit);

      const { rows } = await pool.query(
        `SELECT 
           re.id, re.event_type, re.reward_amount, re.reward_currency,
           re.reward_status, re.payout_scheduled_at, re.payout_completed_at,
           re.stellar_tx_hash, re.fraud_flags, re.created_at,
           u.first_name as referee_first_name, u.last_name as referee_last_name, u.email as referee_email
         FROM referral_events re
         LEFT JOIN users u ON re.referee_id = u.id
         WHERE re.referrer_id = $1
         ORDER BY re.created_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      );

      const { rows: countRows } = await pool.query(
        'SELECT COUNT(*) as total FROM referral_events WHERE referrer_id = $1',
        [userId]
      );

      res.json({
        success: true,
        data: {
          events: rows.map(row => ({
            id: row.id,
            eventType: row.event_type,
            rewardAmount: row.reward_amount ? parseFloat(row.reward_amount) : null,
            rewardCurrency: row.reward_currency,
            rewardStatus: row.reward_status,
            payoutScheduledAt: row.payout_scheduled_at,
            payoutCompletedAt: row.payout_completed_at,
            stellarTxHash: row.stellar_tx_hash,
            fraudFlags: row.fraud_flags,
            createdAt: row.created_at,
            referee: row.referee_first_name ? {
              firstName: row.referee_first_name,
              lastName: row.referee_last_name,
              email: row.referee_email
            } : null
          })),
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total: parseInt(countRows[0].total, 10)
          }
        }
      });
    } catch (error) {
      logger.error("Failed to get referral history", {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  }
};
