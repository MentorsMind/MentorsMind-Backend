import { Router } from 'express';
import { SyncController } from '../controllers/sync.controller';
import { authenticate } from '../middleware/auth.middleware';
import { syncCursorMiddleware } from '../middleware/sync-cursor.middleware';

const router = Router();

router.use(authenticate);
router.use(syncCursorMiddleware);

router.post('/', SyncController.sync);
router.get('/state', SyncController.getState);
router.get('/conflicts', SyncController.getConflicts);

export default router;
