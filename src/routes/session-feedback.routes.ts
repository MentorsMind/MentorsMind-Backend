import { Router } from "express";
import { SessionFeedbackController } from "../controllers/session-feedback.controller";
import { authenticate } from "../middleware/auth.middleware";
import { asyncHandler } from "../utils/asyncHandler.utils";

const router = Router();

/**
 * @swagger
 * /feedback:
 *   post:
 *     summary: Submit feedback for a completed session
 *     tags: [Feedback]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [session_id, rating_content, rating_communication, rating_preparation, rating_value]
 *             properties:
 *               session_id: { type: string, format: uuid }
 *               rating_content: { type: integer, minimum: 1, maximum: 5 }
 *               rating_communication: { type: integer, minimum: 1, maximum: 5 }
 *               rating_preparation: { type: integer, minimum: 1, maximum: 5 }
 *               rating_value: { type: integer, minimum: 1, maximum: 5 }
 *               comment: { type: string }
 *               improvements: { type: array, items: { type: string } }
 *               would_recommend: { type: boolean }
 *     responses:
 *       201:
 *         description: Feedback submitted
 *       400:
 *         description: Session not completed or already reviewed
 *       403:
 *         description: Not authorized
 */
router.post("/", authenticate, asyncHandler(SessionFeedbackController.submit));

/**
 * @swagger
 * /feedback/session/{sessionId}:
 *   get:
 *     summary: Get feedback for a session
 *     tags: [Feedback]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Feedback list
 */
router.get(
  "/session/:sessionId",
  authenticate,
  asyncHandler(SessionFeedbackController.getForSession),
);

/**
 * @swagger
 * /feedback/mentor/{mentorId}:
 *   get:
 *     summary: Get paginated feedback for a mentor
 *     tags: [Feedback]
 *     parameters:
 *       - in: path
 *         name: mentorId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Paginated feedback
 */
router.get(
  "/mentor/:mentorId",
  asyncHandler(SessionFeedbackController.getMentorFeedback),
);

/**
 * @swagger
 * /feedback/mentor/{mentorId}/stats:
 *   get:
 *     summary: Get quality stats for a mentor
 *     tags: [Feedback]
 *     parameters:
 *       - in: path
 *         name: mentorId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Quality statistics
 */
router.get(
  "/mentor/:mentorId/stats",
  asyncHandler(SessionFeedbackController.getMentorStats),
);

export default router;
