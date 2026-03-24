import { Router } from 'express';
import { ResponseUtil } from '../utils/response.utils';
import { asyncHandler } from '../utils/asyncHandler.utils';
import { HealthController } from '../controllers/health.controller';
import HealthService from '../services/health.service';
import v1Routes from './v1';
import { CURRENT_VERSION, SUPPORTED_VERSIONS } from '../config/api-versions.config';

const router = Router();

// ── v1 routes ────────────────────────────────────────────────────────────────
router.use('/', v1Routes);

// ── Root info ────────────────────────────────────────────────────────────────
/**
 * @swagger
 * /:
 *   get:
 *     summary: API version info
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: API info
 */
router.get('/', (_req, res) => {
  ResponseUtil.success(
    res,
    {
      version: CURRENT_VERSION,
      supportedVersions: SUPPORTED_VERSIONS,
      name: 'MentorMinds Stellar API',
      description: 'Backend API for MentorMinds platform',
      endpoints: {
        health: '/health',
        auth: '/api/v1/auth',
        users: '/api/v1/users',
        bookings: '/api/v1/bookings',
      },
      documentation: '/api/v1/docs',
    },
    'Welcome to MentorMinds API',
  );
});

// ── Health ───────────────────────────────────────────────────────────────────
/**
 * @swagger
 * /health:
 *   get:
 *     summary: Service health check
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Service is healthy
 */
router.get('/health', asyncHandler(HealthController.getHealth));

/**
 * @swagger
 * /ready:
 *   get:
 *     summary: Service readiness check
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Service is ready
 *       503:
 *         description: Service not ready
 */
router.get(
  '/ready',
  asyncHandler(async (_req, res) => {
    const health = await HealthService.checkHealth();
    const isReady = health.overall === 'healthy';
    ResponseUtil.success(
      res,
      { ...health, isReady },
      isReady ? 'Service is ready' : 'Service degraded',
      isReady ? 200 : 503,
    );
  }),
);

export default router;
