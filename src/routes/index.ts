import { Router } from "express";
import { ResponseUtil } from "../utils/response.utils";
import authRoutes from "./auth.routes";
import usersRoutes from "./users.routes";
import exportRoutes from "./export.routes";
import adminRoutes from "./admin.routes";
import moderationRoutes from "./moderation.routes";
import bookingsRoutes from "./bookings.routes";
import timezoneRoutes from "./timezone.routes";
import mentorsRoutes from "./mentors.routes";
import paymentsRoutes from "./payments.routes";
import reviewsRoutes from "./reviews.routes";
import conversationsRoutes from "./conversations.routes";
import messageSearchRoutes from "./messageSearch.routes";
import integrationsRoutes from "./integrations.routes";
import consentRoutes from "./consent.routes";
import { BookingsService } from "../services/bookings.service";
import { notificationCleanupService } from "../services/notification-cleanup.service";
import {
  CURRENT_VERSION,
  SUPPORTED_VERSIONS,
} from "../config/api-versions.config";
import { asyncHandler } from "../utils/asyncHandler.utils";
import { HealthController } from "../controllers/health.controller";
import { logger } from "../utils/logger.utils";
import { JwksController } from "../controllers/jwks.controller";
import { metricsRegistry } from "../config/metrics";
import { monitoringConfig } from "../config/monitoring.config";

const router = Router();

// Service initialization (async, non-blocking)
// Note: These services no longer create tables at runtime.
// Table schema is managed exclusively by migration files.
BookingsService.initialize().catch((err: unknown) => {
  logger.error("Failed to initialize bookings service:", err);
});

// Initialize notification cleanup service (async, don't block)
notificationCleanupService.initialize().catch((err: unknown) => {
  logger.error("Failed to initialize notification cleanup service:", err);
});

// Mount route modules
router.use("/auth", authRoutes);
router.use("/users", usersRoutes);
router.use("/", exportRoutes);
router.use("/admin", adminRoutes);
router.use("/admin/moderation", moderationRoutes);
router.use("/bookings", bookingsRoutes);
router.use("/timezones", timezoneRoutes);
router.use("/mentors", mentorsRoutes);
router.use("/payments", paymentsRoutes);
router.use("/reviews", reviewsRoutes);
router.use("/conversations", conversationsRoutes);
router.use("/messages", messageSearchRoutes);
router.use("/integrations", integrationsRoutes);
router.use("/consent", consentRoutes);

// JWKS public endpoint — no auth required
router.get("/.well-known/jwks.json", asyncHandler(JwksController.getJwks));

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
router.get("/", (_req, res) => {
  ResponseUtil.success(
    res,
    {
      version: CURRENT_VERSION,
      supportedVersions: SUPPORTED_VERSIONS,
      name: "MentorMinds Stellar API",
      description: "Backend API for MentorMinds platform",
      endpoints: {
        health: "/health",
        auth: "/api/v1/auth",
        users: "/api/v1/users",
        bookings: "/api/v1/bookings",
      },
      documentation: "/api/v1/docs",
    },
    "Welcome to MentorMinds API",
  );
});

// ── Health ───────────────────────────────────────────────────────────────────
// Health routes moved to app.ts for global accessibility
router.get("/health/live", asyncHandler(HealthController.getLive));
router.get("/health/ready", asyncHandler(HealthController.getReady));
router.get("/health", (_req, res) => res.redirect("/health/ready"));

// ── Metrics ──────────────────────────────────────────────────────────────────
const metricsEndpoint = monitoringConfig.prometheus.endpoint || "/metrics";
router.get(metricsEndpoint, async (_req, res) => {
  try {
    const output = await metricsRegistry.metrics();
    res.setHeader("Content-Type", metricsRegistry.contentType);
    res.send(output);
  } catch {
    res.status(500).send("Error collecting metrics");
  }
});

export default router;
