/**
 * API v1 Route Aggregator
 *
 * All routes mounted here are served under /api/v1/
 *
 * ## Stability guarantee
 * Routes registered in this file are covered by the v1 stability promise.
 * Before modifying any route (path, method, required fields, response shape):
 *   1. Add a `<!-- migration: <description> -->` note in your PR description.
 *   2. If the change is breaking, introduce it in src/routes/v2/ instead.
 *
 * See API_VERSIONING.md for the full versioning policy.
 */
import { Router } from "express";
import authRoutes from "../auth.routes";
import usersRoutes from "../users.routes";
import exportRoutes from "../export.routes";
import adminRoutes from "../admin.routes";
import moderationRoutes from "../moderation.routes";
import bookingsRoutes from "../bookings.routes";
import timezoneRoutes from "../timezone.routes";
import analyticsRoutes from "../analytics.routes";
import disputesRoutes from "../disputes.routes";
import escrowRoutes from "../escrow.routes";
import walletRoutes from "../wallets.routes";
import consentRoutes from "../consent.routes";
import integrationsRoutes from "../integrations.routes";
import notesRoutes from "../notes.routes";
import { BookingsService } from "../../services/bookings.service";
import { logger } from "../../utils/logger";
import { VerificationService } from "../../services/verification.service";
import { notificationCleanupService } from "../../services/notification-cleanup.service";
import { RecommendationService } from "../../services/recommendation.service";

const router = Router();

// Service initialization (async, non-blocking)
BookingsService.initialize().catch((err) => {
  logger.error("Failed to initialize bookings tables:", err);
});
VerificationService.initialize().catch((err: unknown) => {
  logger.error("Failed to initialize verification tables:", err);
});
notificationCleanupService.initialize().catch((err: unknown) => {
  logger.error("Failed to initialize notification cleanup service:", err);
});
RecommendationService.initialize().catch((err: unknown) => {
  logger.error("Failed to initialize recommendation tables:", err);
});

import goalRoutes from "../goal.routes";
import learnerRoutes from "../learner.routes";
//import webhookRoutes from "../webhooks.routes";

router.use("/auth", authRoutes);
router.use("/users", usersRoutes);
router.use("/goals", goalRoutes);
router.use("/learners", learnerRoutes);
router.use("/", exportRoutes);
router.use("/consent", consentRoutes);
router.use("/admin", adminRoutes);
router.use("/admin/moderation", moderationRoutes);
router.use("/bookings", bookingsRoutes);
router.use("/timezones", timezoneRoutes);
router.use("/analytics", analyticsRoutes);
router.use("/disputes", disputesRoutes);
router.use("/escrow", escrowRoutes);
router.use("/wallets", walletRoutes);
router.use("/integrations", integrationsRoutes);
router.use("/", notesRoutes);

export default router;
