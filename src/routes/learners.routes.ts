import { Router } from 'express';
import { getLearnerProgress, updateGoals, getStats } from '../controllers/learners.controller';
import { authenticate, requireRole } from '../middleware/auth.middleware';
import { createGoalValidator } from '../validators/learners.validator';

const router = Router();

// All routes here require the user to be logged in and be a 'mentee'
router.use(authenticate);
router.use(requireRole(['mentee']));

router.get('/me/progress', getLearnerProgress);
router.get('/me/stats', getStats);
router.put('/me/goals', createGoalValidator, updateGoals);

export default router;
