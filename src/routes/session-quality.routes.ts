import { Router } from "express";
import { SessionQualityController } from "../controllers/session-quality.controller";
import { authenticate } from "../middleware/auth.middleware";
import { asyncHandler } from "../utils/asyncHandler.utils";

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Session Quality
 *   description: ML-based session quality analytics and scoring
 */

/**
 * @swagger
 * /session-quality/sessions/{sessionId}:
 *   get:
 *     summary: Get ML quality score for a session
 *     description: |
 *       Computes a composite quality score (0–100) for a completed session using
 *       weighted feedback ratings, sentiment analysis of comments, and session
 *       completion rate. Returns per-dimension scores and a quality tier.
 *     tags: [Session Quality]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Session UUID
 *     responses:
 *       200:
 *         description: Session quality score
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     sessionId:
 *                       type: string
 *                       format: uuid
 *                     overallScore:
 *                       type: integer
 *                       minimum: 0
 *                       maximum: 100
 *                       example: 82
 *                     qualityTier:
 *                       type: string
 *                       enum: [excellent, good, average, poor]
 *                       example: good
 *                     engagementScore:
 *                       type: integer
 *                       example: 85
 *                     contentScore:
 *                       type: integer
 *                       example: 80
 *                     communicationScore:
 *                       type: integer
 *                       example: 90
 *                     preparationScore:
 *                       type: integer
 *                       example: 75
 *                     valueScore:
 *                       type: integer
 *                       example: 80
 *                     sentimentScore:
 *                       type: integer
 *                       example: 65
 *                     completionRate:
 *                       type: integer
 *                       example: 95
 *                     factors:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           name:
 *                             type: string
 *                           weight:
 *                             type: number
 *                           score:
 *                             type: number
 *                           impact:
 *                             type: string
 *                             enum: [positive, negative, neutral]
 *                     computedAt:
 *                       type: string
 *                       format: date-time
 *       404:
 *         description: No feedback found for this session
 */
router.get(
  "/sessions/:sessionId",
  authenticate,
  SessionQualityController.getSessionScore,
);

/**
 * @swagger
 * /session-quality/mentors/{mentorId}/trend:
 *   get:
 *     summary: Get quality trend analysis for a mentor
 *     description: |
 *       Returns weekly quality score history with linear regression trend detection.
 *       Identifies whether the mentor's quality is improving, declining, or stable,
 *       and provides a percentile ranking vs all platform mentors.
 *     tags: [Session Quality]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: mentorId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           default: 90
 *           minimum: 7
 *           maximum: 365
 *         description: Number of days to look back
 *     responses:
 *       200:
 *         description: Quality trend data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     mentorId:
 *                       type: string
 *                       format: uuid
 *                     period:
 *                       type: string
 *                       example: "90d"
 *                     avgScore:
 *                       type: integer
 *                       example: 78
 *                     trend:
 *                       type: string
 *                       enum: [improving, declining, stable]
 *                     trendSlope:
 *                       type: number
 *                       example: 1.5
 *                     percentile:
 *                       type: integer
 *                       example: 72
 *                     scoreHistory:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           date:
 *                             type: string
 *                             format: date
 *                           score:
 *                             type: integer
 *                           sessionCount:
 *                             type: integer
 *                     recommendations:
 *                       type: array
 *                       items:
 *                         type: string
 */
router.get(
  "/mentors/:mentorId/trend",
  authenticate,
  SessionQualityController.getMentorTrend,
);

/**
 * @swagger
 * /session-quality/mentors/{mentorId}/insights:
 *   get:
 *     summary: Get quality insights for a mentor
 *     description: |
 *       Compares a mentor's per-dimension scores against the platform average
 *       and returns categorised insights: strengths, weaknesses, and opportunities.
 *     tags: [Session Quality]
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
 *         description: Quality insights
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
 *                       type:
 *                         type: string
 *                         enum: [strength, weakness, opportunity]
 *                       title:
 *                         type: string
 *                       description:
 *                         type: string
 *                       metric:
 *                         type: string
 *                       value:
 *                         type: integer
 *                       benchmark:
 *                         type: integer
 */
router.get(
  "/mentors/:mentorId/insights",
  authenticate,
  SessionQualityController.getMentorInsights,
);

/**
 * @swagger
 * /session-quality/mentors/{mentorId}/top-sessions:
 *   get:
 *     summary: Get top-performing sessions for a mentor
 *     tags: [Session Quality]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: mentorId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 5
 *           maximum: 20
 *     responses:
 *       200:
 *         description: Top sessions list
 */
router.get(
  "/mentors/:mentorId/top-sessions",
  authenticate,
  SessionQualityController.getTopSessions,
);

/**
 * @swagger
 * /session-quality/platform/distribution:
 *   get:
 *     summary: Get platform-wide quality distribution
 *     description: Returns the distribution of sessions across quality tiers (admin use).
 *     tags: [Session Quality]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Quality distribution
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     distribution:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           tier:
 *                             type: string
 *                           count:
 *                             type: integer
 *                           percentage:
 *                             type: integer
 *                     avgScore:
 *                       type: integer
 *                     totalSessions:
 *                       type: integer
 */
router.get(
  "/platform/distribution",
  authenticate,
  SessionQualityController.getPlatformDistribution,
);

export default router;
