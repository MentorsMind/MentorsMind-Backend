import { Router } from 'express';
import { AdminController } from '../controllers/admin.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireAdmin } from '../middleware/admin-auth.middleware';
import { asyncHandler } from '../utils/asyncHandler.utils';

const router = Router();

// All admin routes require authentication and admin role
router.use(authenticate);
router.use(requireAdmin);

/**
 * @swagger
 * /admin/stats:
 *   get:
 *     summary: Get platform statistics
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.get('/stats', asyncHandler(AdminController.getStats));

/**
 * @swagger
 * /admin/users:
 *   get:
 *     summary: List all users with filters
 *     tags: [Admin]
 */
router.get('/users', asyncHandler(AdminController.listUsers));

/**
 * @swagger
 * /admin/users/{id}/status:
 *   put:
 *     summary: Update user status
 *     tags: [Admin]
 */
router.put('/users/:id/status', asyncHandler(AdminController.updateUserStatus));

/**
 * @swagger
 * /admin/transactions:
 *   get:
 *     summary: List all transactions
 *     tags: [Admin]
 */
router.get('/transactions', asyncHandler(AdminController.listTransactions));

/**
 * @swagger
 * /admin/disputes:
 *   get:
 *     summary: List disputes
 *     tags: [Admin]
 */
router.get('/disputes', asyncHandler(AdminController.listDisputes));

/**
 * @swagger
 * /admin/disputes/{id}/resolve:
 *   post:
 *     summary: Resolve dispute
 *     tags: [Admin]
 */
router.post('/disputes/:id/resolve', asyncHandler(AdminController.resolveDispute));

/**
 * @swagger
 * /admin/system-health:
 *   get:
 *     summary: Get system health
 *     tags: [Admin]
 */
router.get('/system-health', asyncHandler(AdminController.getSystemHealth));

/**
 * @swagger
 * /admin/logs:
 *   get:
 *     summary: Get system logs
 *     tags: [Admin]
 */
router.get('/logs', asyncHandler(AdminController.getLogs));

/**
 * @swagger
 * /admin/config:
 *   post:
 *     summary: Update system configuration
 *     tags: [Admin]
 */
router.post('/config', asyncHandler(AdminController.updateConfig));

export default router;
