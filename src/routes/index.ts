import { Router } from 'express';
import { ResponseUtil } from '../utils/response.utils';
import authRoutes from './auth.routes';
import usersRoutes from './users.routes';
import exportRoutes from './export.routes';
import adminRoutes from './admin.routes';
import bookingsRoutes from './bookings.routes';
import timezoneRoutes from './timezone.routes';
import mentorsRoutes from './mentors.routes';
import paymentsRoutes from './payments.routes';
import { AdminService } from '../services/admin.service';
import { BookingsService } from '../services/bookings.service';
import { logger } from '../utils/logger';

const router = Router();

// Initialize admin tables (async, don't block)
AdminService.initialize().catch((err) => {
  logger.error('Failed to initialize admin tables:', err);
});

// Initialize bookings tables (async, don't block)
BookingsService.initialize().catch(err => {
  logger.error('Failed to initialize bookings tables:', err);
});

// Mount route modules
router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/', exportRoutes);
router.use('/admin', adminRoutes);
router.use('/bookings', bookingsRoutes);
router.use('/timezones', timezoneRoutes);
router.use('/mentors', mentorsRoutes);
router.use('/payments', paymentsRoutes);

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
