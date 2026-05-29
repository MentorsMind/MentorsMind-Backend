import { Router } from 'express';
import { TenantController } from '../controllers/tenant.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/auth.middleware';
import { asyncHandler } from '../utils/asyncHandler.utils';

const router = Router();

// Public: resolve current tenant from hostname
router.get('/current', asyncHandler(TenantController.getCurrent));

// Admin-only: manage tenants
router.use(authenticate as any, requireRole(['admin']) as any);

router.get('/', asyncHandler(TenantController.list));
router.get('/:id', asyncHandler(TenantController.getById));
router.post('/', asyncHandler(TenantController.create));
router.patch('/:id', asyncHandler(TenantController.update));

export default router;
