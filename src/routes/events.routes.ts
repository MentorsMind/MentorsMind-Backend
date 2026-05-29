import express from 'express';
import { getEventHistory, getAggregateState, getEvents } from '../controllers/events.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireAdmin } from '../middleware/admin-auth.middleware';

const router = express.Router();

router.use(authenticate as any);
router.use(requireAdmin as any);

router.get('/aggregate/:aggregateId/history', getEventHistory);
router.get('/aggregate/:aggregateId/events', getEvents);
router.get('/aggregate/:aggregateType/:aggregateId/state', getAggregateState);

export default router;
