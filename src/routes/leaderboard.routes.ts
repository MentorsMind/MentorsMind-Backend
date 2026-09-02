import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { GamificationController } from "../controllers/gamification.controller";

const router = Router();

/**
 * @swagger
 * /api/v1/leaderboard:
 *   get:
 *     summary: Get the public gamification leaderboard (issue #984)
 *     description: >
 *       Supports ?category=sessions&period=monthly (or weekly / all-time).
 *       Category may be sessions|mentors|mentees|skills; defaults to mentors.
 *     tags: [Leaderboard]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: category
 *         schema: { type: string, example: sessions }
 *       - in: query
 *         name: period
 *         schema: { type: string, example: monthly }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0 }
 *     responses:
 *       200:
 *         description: Leaderboard entries
 */
router.get("/", authenticate as any, GamificationController.getGamificationLeaderboard);

export default router;
