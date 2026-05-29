import { Router } from "express";
import { SmartSchedulingController } from "../controllers/smart-scheduling.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

/**
 * @swagger
 * tags:
 *   name: SmartScheduling
 *   description: AI-powered smart meeting scheduling endpoints
 */

/**
 * @swagger
 * /api/v1/bookings/suggest-times:
 *   get:
 *     summary: Suggest optimal meeting times based on availability, timezone and history
 *     tags: [SmartScheduling]
 *     security:
 *       - bearerAuth: true
 *     parameters:
 *       - in: query
 *         name: mentorId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: durationMinutes
 *         schema:
 *           type: integer
 *           default: 60
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date-time
 *     responses:
 *       200:
 *         description: List of optimal scheduling suggestions
 */
router.get(
  "/suggest-times",
  authenticate,
  SmartSchedulingController.suggestOptimalTimes,
);

/**
 * @swagger
 * /api/v1/bookings/{id}/suggest-reschedule:
 *   get:
 *     summary: Suggest alternative reschedule slots for an existing booking
 *     tags: [SmartScheduling]
 *     security:
 *       - bearerAuth: true
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Rescheduling suggestions successfully generated
 */
router.get(
  "/:id/suggest-reschedule",
  authenticate,
  SmartSchedulingController.suggestReschedule,
);

export default router;
