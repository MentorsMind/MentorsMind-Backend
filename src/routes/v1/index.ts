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
import complianceRoutes from "../compliance.routes";
import bulkRoutes from "../bulk.routes";
import integrationsRoutes from "../integrations.routes";
import notesRoutes from "../notes.routes";
import deepLinkRoutes from "../deepLink.routes";
import { BookingsService } from "../../services/bookings.service";
import { logger } from "../../utils/logger";
import { notificationCleanupService } from "../../services/notification-cleanup.service";
import { adminAllowlistMiddleware } from "../middleware/ipFilter.middleware";
import { asyncHandler } from "../../utils/asyncHandler.utils";

const router = Router();

// Service initialization (async, non-blocking)
// Note: These services no longer create tables at runtime.
// Table schema is managed exclusively by migration files.
BookingsService.initialize().catch((err) => {
  logger.error("Failed to initialize bookings service:", err);
});
notificationCleanupService.initialize().catch((err: unknown) => {
  logger.error("Failed to initialize notification cleanup service:", err);
});

import goalRoutes from "../goal.routes";
import learnerRoutes from "../learner.routes";
import webhookRoutes from "../webhooks.routes";
import learningPathRoutes from "../learning-path.routes";
import progressRoutes from "../progress.routes";
import sessionMilestoneRoutes from "../session-milestone.routes";
import notificationsRoutes from "../notifications.routes";
import certificationRoutes from "../certification.routes";
import referralRoutes from "../referral.routes";
import eventsRoutes from "../events.routes";

router.use("/auth", authRoutes);
router.use("/users", usersRoutes);
router.use("/goals", goalRoutes);
router.use("/learners", learnerRoutes);
router.use("/", exportRoutes);
router.use("/consent", consentRoutes);
router.use("/compliance", complianceRoutes);
router.use("/bulk", bulkRoutes);

// Apply IP whitelisting to all admin routes
router.use("/admin", asyncHandler(adminAllowlistMiddleware));
router.use("/admin", adminRoutes);
router.use("/admin/moderation", moderationRoutes);

router.use("/bookings", bookingsRoutes);
router.use("/timezones", timezoneRoutes);
router.use("/analytics", analyticsRoutes);
router.use("/disputes", disputesRoutes);
router.use("/escrow", escrowRoutes);
router.use("/wallets", walletRoutes);
router.use("/integrations", integrationsRoutes);
router.use("/webhooks", webhookRoutes);
router.use("/dl", deepLinkRoutes);
router.use("/notifications", notificationsRoutes);
router.use("/", notesRoutes);

// Learning Path Builder routes
router.use("/learning-paths", learningPathRoutes);
router.use("/progress", progressRoutes);
router.use("/session-milestones", sessionMilestoneRoutes);

// Mentor Certification routes
router.use("/certifications", certificationRoutes);

// Referral and Affiliate Program routes
router.use("/referrals", referralRoutes);
// Event Sourcing / Audit Trail routes
router.use("/events", eventsRoutes);

// Session Quality Analytics (issue #538)
import sessionQualityRoutes from "../session-quality.routes";
router.use("/session-quality", sessionQualityRoutes);

// API Documentation Portal (issue #537)
import apiDocsPortalRoutes from "../api-docs-portal.routes";
router.use("/docs", apiDocsPortalRoutes);

import tenantRoutes from "../tenant.routes";

// Multi-tenant routes
router.use("/tenants", tenantRoutes);

// Dynamic Pricing Engine (issue #560)
import dynamicPricingRoutes from "../dynamic-pricing.routes";
router.use("/pricing", dynamicPricingRoutes);

// Mentor Onboarding Automation (issue #562)
import mentorOnboardingRoutes from "../mentor-onboarding.routes";
router.use("/onboarding", mentorOnboardingRoutes);

export default router;
