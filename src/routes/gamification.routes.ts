import { Router } from 'express';
import { GamificationController } from '../controllers/gamification.controller';
import { authenticate, requireRole } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import {
  leaderboardQuerySchema,
  showcaseUpdateSchema,
  challengeIdParamSchema,
  userIdParamSchema,
  createAchievementSchema,
} from '../validators/schemas/gamification.schemas';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Gamification
 *   description: Gamification, badges, achievements, leaderboards, streaks, and rewards
 */

/**
 * @swagger
 * /api/v1/gamification/achievements:
 *   get:
 *     summary: List all active achievements
 *     tags: [Gamification]
 *     parameters:
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [sessions, learning, social, special]
 *       - in: query
 *         name: rarity
 *         schema:
 *           type: string
 *           enum: [common, rare, epic, legendary]
 *     responses:
 *       200:
 *         description: List of achievements
 */
router.get('/achievements', GamificationController.getAchievements);

/**
 * @swagger
 * /api/v1/gamification/leaderboard:
 *   get:
 *     summary: Get leaderboards (mentors, mentees, skills)
 *     tags: [Gamification]
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [mentor, mentee, skill]
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [daily, weekly, monthly, all-time]
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *       - in: query
 *         name: skill
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Leaderboard rankings
 */
router.get('/leaderboard', validate(leaderboardQuerySchema), GamificationController.getLeaderboard);

/**
 * @swagger
 * /api/v1/gamification/users/{userId}:
 *   get:
 *     summary: Get public gamification progress of a specific user
 *     tags: [Gamification]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User gamification progress
 */
router.get('/users/:userId', validate(userIdParamSchema), GamificationController.getUserProgress);

/**
 * @swagger
 * /api/v1/gamification/me:
 *   get:
 *     summary: Get current authenticated user gamification progress
 *     tags: [Gamification]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: User gamification profile, XP, level, badges, streak, rank
 */
router.get('/me', authenticate as any, GamificationController.getMyProgress);

/**
 * @swagger
 * /api/v1/gamification/check-in:
 *   post:
 *     summary: Daily check-in / activity record for active streak
 *     tags: [Gamification]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Updated streak details
 */
router.post('/check-in', authenticate as any, GamificationController.recordCheckIn);

/**
 * @swagger
 * /api/v1/gamification/challenges:
 *   get:
 *     summary: Get active daily and weekly challenges with user progress
 *     tags: [Gamification]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Active challenges and user status
 */
router.get('/challenges', authenticate as any, GamificationController.getChallenges);

/**
 * @swagger
 * /api/v1/gamification/challenges/{id}/claim:
 *   post:
 *     summary: Claim reward for a completed challenge
 *     tags: [Gamification]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Reward claimed successfully
 */
router.post('/challenges/:id/claim', authenticate as any, validate(challengeIdParamSchema), GamificationController.claimChallengeReward);

/**
 * @swagger
 * /api/v1/gamification/showcase:
 *   put:
 *     summary: Update profile badge showcase
 *     tags: [Gamification]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               badgeIds:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Showcase updated
 */
router.put('/showcase', authenticate as any, validate(showcaseUpdateSchema), GamificationController.updateShowcase);

/**
 * @swagger
 * /api/v1/gamification/rewards:
 *   get:
 *     summary: Get user reward transaction log (XP, XLM tokens, discounts)
 *     tags: [Gamification]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Reward logs list
 */
router.get('/rewards', authenticate as any, GamificationController.getUserRewardLogs);

/**
 * @swagger
 * /api/v1/gamification/admin/achievements:
 *   post:
 *     summary: Admin creation of new achievements
 *     tags: [Gamification]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201:
 *         description: Achievement created
 */
router.post(
  '/admin/achievements',
  authenticate as any,
  requireRole(['admin', 'superadmin']) as any,
  validate(createAchievementSchema),
  GamificationController.adminCreateAchievement,
);

/**
 * @swagger
 * /api/v1/gamification/users/{userId}/achievements:
 *   get:
 *     summary: List a user's earned achievement badges (issue #984)
 *     tags: [Gamification]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: User achievement badges
 */
router.get('/users/:userId/achievements', authenticate as any, GamificationController.getUserAchievements);

/**
 * @swagger
 * /api/v1/gamification/me/streaks:
 *   get:
 *     summary: Get the current user's streak summary (issue #984)
 *     tags: [Gamification]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Current user's streak summary
 */
router.get('/me/streaks', authenticate as any, GamificationController.getMyStreaks);

/**
 * @swagger
 * /api/v1/gamification/leaderboard/categorized:
 *   get:
 *     summary: Get leaderboard by category & period (issue #984)
 *     tags: [Gamification]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           example: sessions
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           example: monthly
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Leaderboard entries
 */
router.get('/leaderboard/categorized', authenticate as any, GamificationController.getGamificationLeaderboard);

export default router;
