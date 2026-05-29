import { Router } from 'express';
import { LearnerController } from '../controllers/learner.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticate as any);

/**
 * @swagger
 * /api/v1/learners/progress:
 *   get:
 *     summary: Get learner's overall progress summary
 *     tags: [Learners]
 */
router.get('/progress', LearnerController.getProgress);

/**
 * @swagger
 * /api/v1/learners/timeline/goals:
 *   get:
 *     summary: Get goal completion timeline over 12 months
 *     tags: [Learners]
 */
router.get('/timeline/goals', LearnerController.getGoalCompletionTimeline);

/**
 * @swagger
 * /api/v1/learners/timeline/sessions:
 *   get:
 *     summary: Get session activity timeline over 12 months
 *     tags: [Learners]
 */
router.get('/timeline/sessions', LearnerController.getSessionTimeline);

export default router;
