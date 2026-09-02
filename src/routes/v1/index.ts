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
import adminBulkRoutes from "../admin-bulk.routes";
import integrationsRoutes from "../integrations.routes";
import notesRoutes from "../notes.routes";
import deepLinkRoutes from "../deepLink.routes";
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
import sessionQualityRoutes from "../session-quality.routes";
import apiDocsPortalRoutes from "../api-docs-portal.routes";
import sandboxRoutes from "../sandbox.routes";
import tenantRoutes from "../tenant.routes";
import dynamicPricingRoutes from "../dynamic-pricing.routes";
import mentorOnboardingRoutes from "../mentor-onboarding.routes";
import chatbotRoutes from "../chatbot.routes";
import featureFlagRoutes from "../feature-flag.routes";
import offlineRoutes from "../offline.routes";
import syncRoutes from "../sync.routes";
import searchRoutes from "../search.routes";
import nlpSearchRoutes from "../nlp-search.routes";
import errorsRoutes from "../errors.routes";
import developerRoutes from "../developer.routes";
import taxRoutes from "../tax.routes";
import emailWebhookRoutes from "../emailWebhook.routes";
import gamificationRoutes from "../gamification.routes";
import leaderboardRoutes from "../leaderboard.routes";

import { BookingsService } from "../../services/bookings.service";
import { logger } from "../../utils/logger";
import { notificationCleanupService } from "../../services/notification-cleanup.service";
import { adminAllowlistMiddleware } from "../../middleware/ipFilter.middleware";

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

router.use("/auth", authRoutes);
router.use("/users", usersRoutes);
router.use("/goals", goalRoutes);
router.use("/learners", learnerRoutes);
router.use("/learner", learnerRoutes);
router.use("/", exportRoutes);
router.use("/consent", consentRoutes);
router.use("/compliance", complianceRoutes);
router.use("/bulk", bulkRoutes);

// Apply IP whitelisting to all admin routes
router.use("/admin", adminAllowlistMiddleware);
router.use("/admin", adminRoutes);
router.use("/admin/bulk", adminBulkRoutes);
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
router.use("/tenant/email-templates", tenantEmailTemplatesRoutes);

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
router.use("/session-quality", sessionQualityRoutes);

// API Documentation Portal (issue #537, extended in #784)
router.use("/docs", apiDocsPortalRoutes);

// Sandbox fixture routes for the docs portal "Try it out" flow (issue #784).
// Gated by SANDBOX_MODE — see src/routes/sandbox.routes.ts.
router.use("/sandbox", sandboxRoutes);

// Multi-tenant routes
router.use("/tenants", tenantRoutes);

// Dynamic Pricing Engine (issue #560)
router.use("/pricing", dynamicPricingRoutes);

// Mentor Onboarding Automation (issue #562)
router.use("/onboarding", mentorOnboardingRoutes);
router.use("/chatbot", chatbotRoutes);

// Feature Flags (issue #688) — real-time rollout/targeting evaluation + admin CRUD
router.use("/", featureFlagRoutes);

// Offline sync — snapshot/delta/queue endpoints for mobile clients (issue #689)
router.use("/offline", offlineRoutes);

// Offline sync v2 — vector-clock batch sync endpoints (issue #689)
router.use("/sync", syncRoutes);

// Unified global search across mentors, sessions, and messages (issue #738)
router.use("/search", searchRoutes);

// NLP-powered natural language mentor search (issue #739)
router.use("/search", nlpSearchRoutes);
// Error catalog endpoint
router.use("/errors", errorsRoutes);
// Developer API key management (issue #838)
router.use("/developer", developerRoutes);

// Tax reporting export (issue #978) — /api/v1/tax
router.use("/tax", taxRoutes);

// Inbound provider webhooks (issue #979) — unauthenticated, signature-verified
router.use("/webhooks/email", emailWebhookRoutes);

// Verifiable Credentials (DID / W3C VC)
router.use("/credentials", credentialsRoutes);

// Gamification & Achievement System
router.use("/gamification", gamificationRoutes);

// Public leaderboard (issue #984): /api/v1/leaderboard?category=sessions&period=monthly
router.use("/leaderboard", leaderboardRoutes);

export default router;
