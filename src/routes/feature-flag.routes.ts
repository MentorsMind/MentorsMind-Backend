import { Router } from 'express';
import { FeatureFlagController } from '../controllers/feature-flag.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireAdmin } from '../middleware/rbac.middleware';

const router = Router();

// ── Public evaluation (requires auth to identify user) ───────────────────────
router.get('/evaluate/:key', authenticate, FeatureFlagController.evaluate);
router.post('/evaluate/:key/conversion', authenticate, FeatureFlagController.trackConversion);

// ── Admin CRUD (admin only) ───────────────────────────────────────────────────
router.use(authenticate, requireAdmin);

router.get('/', FeatureFlagController.list);
router.post('/', FeatureFlagController.create);
router.get('/key/:key', FeatureFlagController.getByKey);
router.get('/:id', FeatureFlagController.getById);
router.put('/:id', FeatureFlagController.update);
router.delete('/:id', FeatureFlagController.remove);
router.post('/:id/disable', FeatureFlagController.disable);
router.get('/metrics/:key', FeatureFlagController.getMetrics);

export default router;
