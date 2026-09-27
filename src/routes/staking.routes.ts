import { Router } from 'express';
import { StakingService } from '../services/staking.service';
import { authenticateJWT } from '../middleware/auth.middleware';
import { ResponseUtil } from '../utils/response.utils';
import { asyncHandler } from '../utils/asyncHandler.utils';
import { WalletModel } from '../models/wallet.model';

const router = Router();

/**
 * @swagger
 * /api/v1/staking/positions:
 *   get:
 *     summary: Get current user's staking position
 *     tags: [Staking]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/positions',
  authenticateJWT,
  asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) {
      return ResponseUtil.unauthorized(res, 'User not authenticated');
    }

    try {
      const position = await StakingService.getStakeByUserId(userId);
      if (!position) {
        return ResponseUtil.success(res, null, 'No staking position found');
      }
      return ResponseUtil.success(res, position, 'Staking position retrieved');
    } catch (error: any) {
      if (error.message === 'Staking contract not configured') {
        return ResponseUtil.error(res, 'Staking not configured', 503);
      }
      throw error;
    }
  }),
);

/**
 * @swagger
 * /api/v1/staking/positions/{mentorId}:
 *   get:
 *     summary: Get a specific mentor's staking position
 *     tags: [Staking]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/positions/:mentorId',
  authenticateJWT,
  asyncHandler(async (req, res) => {
    const { mentorId } = req.params;

    try {
      // Check if mentorId is a Stellar public key (starts with G) or a User ID
      let stellarPublicKey = mentorId;
      if (!mentorId.startsWith('G')) {
        const wallet = await WalletModel.findByUserId(mentorId);
        if (!wallet || !wallet.stellar_public_key) {
          return ResponseUtil.success(res, null, 'Mentor wallet not found');
        }
        stellarPublicKey = wallet.stellar_public_key;
      }

      const position = await StakingService.getStake(stellarPublicKey);
      if (!position) {
        return ResponseUtil.success(res, null, 'No staking position found');
      }
      return ResponseUtil.success(res, position, 'Staking position retrieved');
    } catch (error: any) {
      if (error.message === 'Staking contract not configured') {
        return ResponseUtil.error(res, 'Staking not configured', 503);
      }
      throw error;
    }
  }),
);

export default router;
