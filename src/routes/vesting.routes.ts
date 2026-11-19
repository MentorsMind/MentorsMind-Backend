import { Router } from 'express';
import {
  createVestingSchedule,
  getAllVestingSchedules,
  getVestingScheduleById,
  revokeVestingSchedule,
  getMyVestingSchedules,
  claimVesting,
  getVestingClaimHistory,
  getVestingSchedulesByAddress,
} from '../controllers/vesting.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireAdmin } from '../middleware/admin-auth.middleware';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Vesting
 *   description: Token vesting schedule management
 */

/**
 * @swagger
 * /api/v1/admin/vesting/schedules:
 *   post:
 *     summary: Create a new vesting schedule
 *     tags: [Vesting]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - beneficiaryAddress
 *               - totalAmount
 *               - cliffDuration
 *               - vestingDuration
 *               - vestingType
 *             properties:
 *               beneficiaryAddress:
 *                 type: string
 *                 description: Stellar address of the beneficiary
 *                 example: "GABC..."
 *               totalAmount:
 *                 type: string
 *                 description: Total vesting amount (in stroops or XLM)
 *                 example: "1000000"
 *               cliffDuration:
 *                 type: number
 *                 description: Cliff duration in seconds (min 3600 or 0)
 *                 example: 7776000
 *               vestingDuration:
 *                 type: number
 *                 description: Total vesting duration in seconds (min 86400)
 *                 example: 31536000
 *               startTimestamp:
 *                 type: number
 *                 description: Start timestamp (0 or omit for immediate start)
 *                 example: 0
 *               vestingType:
 *                 type: string
 *                 enum: [team, advisor, mentor_grant, investor, early_contributor, partnership, community_grant, other]
 *                 example: "team"
 *               notes:
 *                 type: string
 *                 description: Optional notes about the schedule
 *               beneficiaryUserId:
 *                 type: string
 *                 description: Optional UUID linking to users table
 *     responses:
 *       201:
 *         description: Vesting schedule created successfully
 *       400:
 *         description: Invalid input
 *       422:
 *         description: Validation error (cliff or vesting duration)
 *       401:
 *         description: Unauthorized
 */
router.post(
  '/admin/vesting/schedules',
  authenticate,
  requireAdmin,
  createVestingSchedule,
);

/**
 * @swagger
 * /api/v1/admin/vesting/schedules:
 *   get:
 *     summary: Get all vesting schedules (admin)
 *     tags: [Vesting]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, revoked, completed]
 *         description: Filter by status
 *       - in: query
 *         name: vestingType
 *         schema:
 *           type: string
 *         description: Filter by vesting type
 *       - in: query
 *         name: limit
 *         schema:
 *           type: number
 *           default: 50
 *         description: Number of results per page
 *       - in: query
 *         name: offset
 *         schema:
 *           type: number
 *           default: 0
 *         description: Pagination offset
 *     responses:
 *       200:
 *         description: List of vesting schedules
 *       401:
 *         description: Unauthorized
 */
router.get(
  '/admin/vesting/schedules',
  authenticate,
  requireAdmin,
  getAllVestingSchedules,
);

/**
 * @swagger
 * /api/v1/admin/vesting/schedules/{id}:
 *   get:
 *     summary: Get vesting schedule by ID (admin)
 *     tags: [Vesting]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: number
 *         description: Schedule ID
 *     responses:
 *       200:
 *         description: Vesting schedule details
 *       404:
 *         description: Schedule not found
 *       401:
 *         description: Unauthorized
 */
router.get(
  '/admin/vesting/schedules/:id',
  authenticate,
  requireAdmin,
  getVestingScheduleById,
);

/**
 * @swagger
 * /api/v1/admin/vesting/schedules/{id}:
 *   delete:
 *     summary: Revoke a vesting schedule (admin)
 *     tags: [Vesting]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: number
 *         description: Schedule ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 description: Reason for revocation
 *     responses:
 *       200:
 *         description: Schedule revoked successfully
 *       404:
 *         description: Schedule not found
 *       401:
 *         description: Unauthorized
 */
router.delete(
  '/admin/vesting/schedules/:id',
  authenticate,
  requireAdmin,
  revokeVestingSchedule,
);

/**
 * @swagger
 * /api/v1/vesting/my-schedules:
 *   get:
 *     summary: Get my vesting schedules (beneficiary)
 *     tags: [Vesting]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of user's vesting schedules with claimable amounts
 *       401:
 *         description: Unauthorized
 */
router.get(
  '/vesting/my-schedules',
  authenticate,
  getMyVestingSchedules,
);

/**
 * @swagger
 * /api/v1/vesting/schedules/{id}/claim:
 *   post:
 *     summary: Claim vested tokens from a schedule (beneficiary)
 *     tags: [Vesting]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: number
 *         description: Schedule ID
 *     responses:
 *       200:
 *         description: Tokens claimed successfully
 *       400:
 *         description: No tokens available to claim
 *       403:
 *         description: Not the beneficiary of this schedule
 *       404:
 *         description: Schedule not found
 *       401:
 *         description: Unauthorized
 */
router.post(
  '/vesting/schedules/:id/claim',
  authenticate,
  claimVesting,
);

/**
 * @swagger
 * /api/v1/vesting/schedules/{id}/claims:
 *   get:
 *     summary: Get claim history for a schedule
 *     tags: [Vesting]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: number
 *         description: Schedule ID
 *     responses:
 *       200:
 *         description: List of claims for this schedule
 *       403:
 *         description: Access denied
 *       404:
 *         description: Schedule not found
 *       401:
 *         description: Unauthorized
 */
router.get(
  '/vesting/schedules/:id/claims',
  authenticate,
  getVestingClaimHistory,
);

/**
 * @swagger
 * /api/v1/vesting/schedules/by-address/{address}:
 *   get:
 *     summary: Get vesting schedules by beneficiary address
 *     tags: [Vesting]
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *         description: Stellar address
 *     responses:
 *       200:
 *         description: List of vesting schedules for the address
 *       400:
 *         description: Invalid address
 */
router.get(
  '/vesting/schedules/by-address/:address',
  getVestingSchedulesByAddress,
);

export default router;
