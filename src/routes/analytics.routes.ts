// @ts-nocheck
import { Router } from 'express';
import { AnalyticsController } from '../controllers/analytics.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { validate } from '../middleware/validation.middleware';
import { asyncHandler } from '../utils/asyncHandler.utils';
import { z } from 'zod';

const router = Router();

// All analytics routes require admin privileges
router.use(authenticate);
router.use(requireRole('admin'));

const periodQuerySchema = z.object({
  query: z.object({
    period: z.enum(['7d', '30d', '90d', '1y']).optional().default('30d'),
  }),
});

/**
 * @swagger
 * /admin/analytics/overview:
 *   get:
 *     summary: Platform KPI summary
 *     tags: [Admin Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Platform KPI summary
 */
router.get('/overview', asyncHandler(AnalyticsController.getOverview));

/**
 * @swagger
 * /admin/analytics/revenue:
 *   get:
 *     summary: Revenue breakdown
 *     tags: [Admin Analytics]
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [7d, 30d, 90d, 1y]
 *     responses:
 *       200:
 *         description: Revenue breakdown
 */
router.get('/revenue', validate(periodQuerySchema), asyncHandler(AnalyticsController.getRevenue));

/**
 * @swagger
 * /admin/analytics/users:
 *   get:
 *     summary: User growth and retention
 *     tags: [Admin Analytics]
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [7d, 30d, 90d, 1y]
 *     responses:
 *       200:
 *         description: User growth and retention
 */
router.get('/users', validate(periodQuerySchema), asyncHandler(AnalyticsController.getUsers));

/**
 * @swagger
 * /admin/analytics/sessions:
 *   get:
 *     summary: Session completion rates
 *     tags: [Admin Analytics]
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [7d, 30d, 90d, 1y]
 *     responses:
 *       200:
 *         description: Session completion rates
 */
router.get('/sessions', validate(periodQuerySchema), asyncHandler(AnalyticsController.getSessions));

/**
 * @swagger
 * /admin/analytics/payments:
 *   get:
 *     summary: Payment volume and method breakdown
 *     tags: [Admin Analytics]
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [7d, 30d, 90d, 1y]
 *     responses:
 *       200:
 *         description: Payment volume and method breakdown
 */
router.get('/payments', validate(periodQuerySchema), asyncHandler(AnalyticsController.getPayments));

export default router;
