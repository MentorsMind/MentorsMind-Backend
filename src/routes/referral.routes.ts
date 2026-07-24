import { Router } from "express";
import { ReferralController } from "../controllers/referral.controller";
import { authenticate } from "../middleware/auth.middleware";

/**
 * Referral Routes
 * API endpoints for referral code management and statistics
 */

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * @route   GET /api/v1/referrals/code
 * @desc    Get or create referral code for authenticated user
 * @access  Private
 */
router.get("/code", ReferralController.getMyReferralCode);

/**
 * @route   POST /api/v1/referrals/apply
 * @desc    Apply referral code during signup
 * @access  Private
 */
router.post("/apply", ReferralController.applyReferralCode);

/**
 * @route   GET /api/v1/referrals/stats
 * @desc    Get referral statistics (total earnings, pending, paid)
 * @access  Private
 */
router.get("/stats", ReferralController.getReferralStats);

/**
 * @route   GET /api/v1/referrals/history
 * @desc    Get referral event history
 * @access  Private
 */
router.get("/history", ReferralController.getReferralHistory);

export default router;
