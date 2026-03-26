/**
 * API v1 Route Aggregator
 *
 * All routes mounted here are served under /api/v1/
 */
import { Router } from 'express';
import authRoutes from '../auth.routes';
import usersRoutes from '../users.routes';
import exportRoutes from '../export.routes';
import adminRoutes from '../admin.routes';
import bookingsRoutes from '../bookings.routes';
import timezoneRoutes from '../timezone.routes';
import analyticsRoutes from '../analytics.routes';
import disputesRoutes from '../disputes.routes';
import escrowRoutes from '../escrow.routes';
import { AdminService } from '../../services/admin.service';
import { BookingsService } from '../../services/bookings.service';
import { logger } from '../../utils/logger';

const router = Router();

// Lazy service initialization (non-blocking)
AdminService.initialize().catch((err) => {
  logger.error('Failed to initialize admin tables:', err);
});
BookingsService.initialize().catch((err) => {
  logger.error('Failed to initialize bookings tables:', err);
});

router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/', exportRoutes);
router.use('/admin', adminRoutes);
router.use('/bookings', bookingsRoutes);
router.use('/timezones', timezoneRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/disputes', disputesRoutes);
router.use('/escrow', escrowRoutes);

export default router;
