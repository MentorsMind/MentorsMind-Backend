import { Router } from 'express';
import { GoalController } from '../controllers/goal.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Apply authentication to all goal routes
router.use(authenticate as any);

/**
 * @swagger
 * /api/v1/goals:
 *   post:
 *     summary: Create a new learning goal
 *     tags: [Goals]
 *     security: [{ bearerAuth: [] }]
 */
router.post('/', GoalController.create);

/**
 * @swagger
 * /api/v1/goals:
 *   get:
 *     summary: List user's goals
 *     tags: [Goals]
 *     security: [{ bearerAuth: [] }]
 */
router.get('/', GoalController.list);

/**
 * @swagger
 * /api/v1/goals/{id}:
 *   get:
 *     summary: Get specific goal
 *     tags: [Goals]
 */
router.get('/:id', GoalController.get);

/**
 * @swagger
 * /api/v1/goals/{id}:
 *   put:
 *     summary: Update goal title, description, or target_date
 *     tags: [Goals]
 */
router.put('/:id', GoalController.update);

/**
 * @swagger
 * /api/v1/goals/{id}:
 *   delete:
 *     summary: Delete goal
 *     tags: [Goals]
 */
router.delete('/:id', GoalController.delete);

/**
 * @swagger
 * /api/v1/goals/{id}/progress:
 *   post:
 *     summary: Log goal progress history
 *     tags: [Goals]
 *     security: [{ bearerAuth: [] }]
 */
router.post('/:id/progress', GoalController.updateProgress);

/**
 * @swagger
 * /api/v1/goals/{id}/progress:
 *   get:
 *     summary: View goal progress history
 *     tags: [Goals]
 *     security: [{ bearerAuth: [] }]
 */
router.get('/:id/progress', GoalController.getProgress);

/**
 * @swagger
 * /api/v1/goals/{id}/link-session:
 *   post:
 *     summary: Link session (booking) to goal
 *     tags: [Goals]
 */
router.post('/:id/link-session', GoalController.linkSession);

export default router;
