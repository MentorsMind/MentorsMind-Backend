import { Router } from 'express';
import { listTimezones, getTimezoneDetails } from '../controllers/timezone.controller';
import { asyncHandler } from '../utils/asyncHandler.utils';

const router = Router();

/**
 * @swagger
 * /api/v1/timezones:
 *   get:
 *     summary: List all valid IANA timezones
 *     tags: [Timezones]
 *     responses:
 *       200:
 *         description: List of timezones with offsets
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       identifier:
 *                         type: string
 *                         example: America/New_York
 *                       offset:
 *                         type: string
 *                         example: UTC-05:00
 *                       currentTime:
 *                         type: string
 *                         format: date-time
 */
router.get('/', asyncHandler(listTimezones));

/**
 * @swagger
 * /api/v1/timezones/{identifier}:
 *   get:
 *     summary: Get details for specific timezone
 *     tags: [Timezones]
 *     parameters:
 *       - in: path
 *         name: identifier
 *         required: true
 *         schema:
 *           type: string
 *         description: IANA timezone identifier (URL-encoded)
 *         example: America%2FNew_York
 *     responses:
 *       200:
 *         description: Timezone details
 *       400:
 *         description: Invalid timezone identifier
 */
router.get('/:identifier', asyncHandler(getTimezoneDetails));

export default router;
