/**
 * API v2 Route Aggregator
 *
 * Serves all routes under /api/v2/. Currently mirrors the v1 surface area —
 * as breaking changes are introduced, swap individual imports for v2-specific
 * route modules rather than modifying the shared ones.
 *
 * To add a v2-only route:
 *   1. Create src/routes/v2/<domain>.routes.ts with the new contract.
 *   2. Replace the corresponding shared import below with the v2 module.
 *
 * See API_VERSIONING.md for the full versioning policy.
 */
import { Router } from 'express';

// ── Shared route modules (identical contract to v1) ───────────────────────────
import authRoutes from '../auth.routes';
import usersRoutes from '../users.routes';
import exportRoutes from '../export.routes';
import adminRoutes from '../admin.routes';
import bookingsRoutes from '../bookings.routes';
import timezoneRoutes from '../timezone.routes';
import analyticsRoutes from '../analytics.routes';
import disputesRoutes from '../disputes.routes';
import escrowRoutes from '../escrow.routes';
import walletRoutes from '../wallets.routes';
import consentRoutes from '../consent.routes';
import integrationsRoutes from '../integrations.routes';
import goalRoutes from '../goal.routes';
import learnerRoutes from '../learner.routes';
import mentorsRoutes from '../mentors.routes';
import paymentsRoutes from '../payments.routes';
import reviewsRoutes from '../reviews.routes';
import conversationsRoutes from '../conversations.routes';
import messageSearchRoutes from '../messageSearch.routes';
import notificationsRoutes from '../notifications.routes';
import searchRoutes from '../search.routes';
import jobsRoutes from '../jobs.routes';

// ── Middleware ────────────────────────────────────────────────────────────────
import { asyncHandler } from '../../utils/asyncHandler.utils';
import { JwksController } from '../../controllers/jwks.controller';

const router = Router();

// ── Route mounts ──────────────────────────────────────────────────────────────
router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/goals', goalRoutes);
router.use('/learners', learnerRoutes);
router.use('/', exportRoutes);
router.use('/consent', consentRoutes);
router.use('/admin', adminRoutes);
router.use('/admin/jobs', jobsRoutes);
router.use('/bookings', bookingsRoutes);
router.use('/timezones', timezoneRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/disputes', disputesRoutes);
router.use('/escrow', escrowRoutes);
router.use('/wallets', walletRoutes);
router.use('/integrations', integrationsRoutes);
router.use('/mentors', mentorsRoutes);
router.use('/payments', paymentsRoutes);
router.use('/reviews', reviewsRoutes);
router.use('/conversations', conversationsRoutes);
router.use('/messages', messageSearchRoutes);
router.use('/notifications', notificationsRoutes);
router.use('/search', searchRoutes);

// JWKS public endpoint — no auth required
router.get('/.well-known/jwks.json', asyncHandler(JwksController.getJwks));

export default router;
