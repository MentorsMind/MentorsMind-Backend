import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { asyncHandler } from "../utils/asyncHandler.utils";
import { RecommendationsController } from "../controllers/recommendations.controller";

const router = Router();

/**
 * @swagger
 * /recommendations/mentors:
 *   get:
 *     summary: Get personalised mentor recommendations
 *     tags: [Recommendations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 10
 *         description: Number of recommendations to return
 *     responses:
 *       200:
 *         description: List of recommended mentors with scores
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/mentors",
  authenticate,
  asyncHandler(RecommendationsController.getMentors),
);

/**
 * @swagger
 * /recommendations/mentors/{mentorId}/click:
 *   post:
 *     summary: Track a recommendation click (CTR)
 *     tags: [Recommendations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: mentorId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Click tracked
 *       401:
 *         description: Unauthorized
 */
router.post(
  "/mentors/:mentorId/click",
  authenticate,
  asyncHandler(RecommendationsController.trackClick),
);

export default router;
