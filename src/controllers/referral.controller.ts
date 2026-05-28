import { Request, Response, NextFunction } from "express";
import { ReferralService } from "../services/referral.service";
import { AffiliateService } from "../services/affiliate.service";
import { logger } from "../utils/logger.utils";
import { createError } from "../middleware/errorHandler";

export const ReferralController = {
  /**
   * Create referral code
   * POST /api/v1/referrals/codes
   */
  async createReferralCode(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw createError("Unauthorized", 401);
      }

      const { codeType, customCode, maxUses, expiresAt, metadata } = req.body;

      const referralCode = await ReferralService.createReferralCode({
        userId,
        codeType,
        customCode,
        maxUses,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
        metadata
      });

      res.status(201).json({
        success: true,
        data: referralCode
      });
    } catch (error) {
      logger.error("Failed to create referral code", {
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  },

  /**
   * Get user's referral codes
   * GET /api/v1/referrals/codes
   */
  async getUserReferralCodes(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw createError("Unauthorized", 401);
      }

      const codes = await ReferralService.getUserReferralCodes(userId);

      res.status(200).json({
        success: true,
        data: codes
      });
    } catch (error) {
      logger.error("Failed to get referral codes", {
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  },

  /**
   * Validate referral code
   * GET /api/v1/referrals/codes/:code/validate
   */
  async validateReferralCode(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { code } = req.params;

      const referralCode = await ReferralService.getReferralCodeByCode(code);

      if (!referralCode) {
        res.status(200).json({
          success: true,
          data: {
            valid: false,
            message: "Invalid or expired referral code"
          }
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: {
          valid: true,
          code: referralCode.code,
          codeType: referralCode.codeType
        }
      });
    } catch (error) {
      logger.error("Failed to validate referral code", {
        code: req.params.code,
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  },

  /**
   * Apply referral code (create referral)
   * POST /api/v1/referrals/apply
   */
  async applyReferralCode(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { referralCode, referredEmail, metadata } = req.body;

      if (!referralCode) {
        throw createError("Referral code is required", 400);
      }

      const referral = await ReferralService.createReferral({
        referralCode,
        referredEmail,
        metadata
      });

      res.status(201).json({
        success: true,
        data: referral
      });
    } catch (error) {
      logger.error("Failed to apply referral code", {
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  },

  /**
   * Get user's referrals
   * GET /api/v1/referrals
   */
  async getUserReferrals(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw createError("Unauthorized", 401);
      }

      const { status } = req.query;

      const referrals = await ReferralService.getUserReferrals(
        userId,
        status as any
      );

      res.status(200).json({
        success: true,
        data: referrals
      });
    } catch (error) {
      logger.error("Failed to get user referrals", {
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  },

  /**
   * Get referral statistics
   * GET /api/v1/referrals/stats
   */
  async getReferralStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id;
      const { global } = req.query;

      // Only admins can view global stats
      if (global === 'true' && req.user?.role !== 'admin') {
        throw createError("Access denied", 403);
      }

      const stats = await ReferralService.getReferralStats(
        global === 'true' ? undefined : userId
      );

      res.status(200).json({
        success: true,
        data: stats
      });
    } catch (error) {
      logger.error("Failed to get referral stats", {
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  },

  /**
   * Update referral status (admin only)
   * PUT /api/v1/referrals/:referralId
   */
  async updateReferral(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { referralId } = req.params;
      const { status, conversionType, referredUserId, metadata } = req.body;

      const referral = await ReferralService.updateReferral(referralId, {
        status,
        conversionType,
        referredUserId,
        metadata
      });

      res.status(200).json({
        success: true,
        data: referral
      });
    } catch (error) {
      logger.error("Failed to update referral", {
        referralId: req.params.referralId,
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  },

  /**
   * Create affiliate profile
   * POST /api/v1/referrals/affiliate
   */
  async createAffiliateProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw createError("Unauthorized", 401);
      }

      const { stellarAddress, paymentSchedule, minimumPayout } = req.body;

      const profile = await AffiliateService.createAffiliateProfile({
        userId,
        stellarAddress,
        paymentSchedule,
        minimumPayout
      });

      res.status(201).json({
        success: true,
        data: profile
      });
    } catch (error) {
      logger.error("Failed to create affiliate profile", {
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  },

  /**
   * Get affiliate profile
   * GET /api/v1/referrals/affiliate/:userId
   */
  async getAffiliateProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { userId } = req.params;

      // Users can only view their own profile, admins can view all
      if (req.user?.role !== 'admin' && req.user?.id !== userId) {
        throw createError("Access denied", 403);
      }

      const profile = await AffiliateService.getAffiliateProfile(userId);

      if (!profile) {
        throw createError("Affiliate profile not found", 404);
      }

      res.status(200).json({
        success: true,
        data: profile
      });
    } catch (error) {
      logger.error("Failed to get affiliate profile", {
        userId: req.params.userId,
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  },

  /**
   * Update affiliate profile
   * PUT /api/v1/referrals/affiliate/:userId
   */
  async updateAffiliateProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { userId } = req.params;

      // Users can only update their own profile
      if (req.user?.id !== userId) {
        throw createError("Access denied", 403);
      }

      const { stellarAddress, paymentSchedule, minimumPayout } = req.body;

      const profile = await AffiliateService.updateAffiliateProfile(userId, {
        stellarAddress,
        paymentSchedule,
        minimumPayout
      });

      res.status(200).json({
        success: true,
        data: profile
      });
    } catch (error) {
      logger.error("Failed to update affiliate profile", {
        userId: req.params.userId,
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  },

  /**
   * Get affiliate dashboard
   * GET /api/v1/referrals/affiliate/:userId/dashboard
   */
  async getAffiliateDashboard(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { userId } = req.params;

      // Users can only view their own dashboard
      if (req.user?.id !== userId) {
        throw createError("Access denied", 403);
      }

      const dashboard = await AffiliateService.getAffiliateDashboard(userId);

      res.status(200).json({
        success: true,
        data: dashboard
      });
    } catch (error) {
      logger.error("Failed to get affiliate dashboard", {
        userId: req.params.userId,
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  },

  /**
   * Approve affiliate profile (admin only)
   * POST /api/v1/referrals/affiliate/:userId/approve
   */
  async approveAffiliateProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { userId } = req.params;
      const approvedBy = req.user?.id;

      if (!approvedBy) {
        throw createError("Unauthorized", 401);
      }

      await AffiliateService.approveAffiliateProfile(userId, approvedBy);

      res.status(200).json({
        success: true,
        message: "Affiliate profile approved"
      });
    } catch (error) {
      logger.error("Failed to approve affiliate profile", {
        userId: req.params.userId,
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  },

  /**
   * Get reward tiers
   * GET /api/v1/referrals/tiers
   */
  async getRewardTiers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const tiers = await AffiliateService.getRewardTiers();

      res.status(200).json({
        success: true,
        data: tiers
      });
    } catch (error) {
      logger.error("Failed to get reward tiers", {
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  },

  /**
   * Request payout (admin only for now)
   * POST /api/v1/referrals/affiliate/:userId/payout
   */
  async requestPayout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { userId } = req.params;
      const { amount, payoutType, metadata } = req.body;

      // Get affiliate profile
      const profile = await AffiliateService.getAffiliateProfile(userId);
      if (!profile) {
        throw createError("Affiliate profile not found", 404);
      }

      if (!amount) {
        throw createError("Amount is required", 400);
      }

      const payout = await AffiliateService.processPayout({
        affiliateId: profile.id,
        amount: parseFloat(amount),
        payoutType: payoutType || 'referral',
        metadata
      });

      res.status(201).json({
        success: true,
        data: payout
      });
    } catch (error) {
      logger.error("Failed to request payout", {
        userId: req.params.userId,
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  }
};
