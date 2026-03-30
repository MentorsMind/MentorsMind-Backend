import { Router } from "express";
import { AdminController } from "../controllers/admin.controller";
import { AnalyticsController } from "../controllers/analytics.controller";
import { ModerationController } from "../controllers/moderation.controller";
import { VerificationController } from "../controllers/verification.controller";
import { RevenueReportController } from "../controllers/revenueReport.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireAdmin } from "../middleware/admin-auth.middleware";
import { validate } from "../middleware/validation.middleware";
import { asyncHandler } from "../utils/asyncHandler.utils";
import { logger } from "../utils/logger.utils";
import {
  rejectVerificationSchema,
  requestMoreInfoSchema,
  listVerificationsSchema,
} from "../validators/schemas/verification.schemas";
import { ConsentController } from "../controllers/consent.controller";
import { refreshAnalyticsJob } from "../jobs/refreshAnalytics.job";

const router = Router();

router.use(authenticate);
router.use(requireAdmin);
refreshAnalyticsJob.initialize().catch((error: unknown) => {
  logger.error("Failed to initialize hourly analytics refresh job", { error });
});

/**
 * @swagger
 * /admin/stats:
 *   get:
 *     summary: Get platform statistics
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Platform statistics
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/AdminStats'
 *       403:
 *         description: Admin role required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/stats", asyncHandler(AdminController.getStats));

/**
 * @swagger
 * /admin/users:
 *   get:
 *     summary: List all users with optional filters
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: page
 *         in: query
 *         schema: { type: integer, default: 1 }
 *       - name: limit
 *         in: query
 *         schema: { type: integer, default: 50, maximum: 100 }
 *       - name: role
 *         in: query
 *         schema: { type: string, enum: [mentor, mentee, admin] }
 *     responses:
 *       200:
 *         description: Paginated list of users
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         users:
 *                           type: array
 *                           items:
 *                             $ref: '#/components/schemas/User'
 *                         meta:
 *                           $ref: '#/components/schemas/PaginationMeta'
 *       403:
 *         description: Admin role required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/users", asyncHandler(AdminController.listUsers));

/**
 * @swagger
 * /admin/users/{id}/status:
 *   put:
 *     summary: Activate or deactivate a user account
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/schemas/UUIDParam'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateUserStatusRequest'
 *           example:
 *             isActive: false
 *     responses:
 *       200:
 *         description: User status updated
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/User'
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.put("/users/:id/status", asyncHandler(AdminController.updateUserStatus));

/**
 * @swagger
 * /admin/users/{id}/suspend:
 *   put:
 *     summary: Suspend user account
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/schemas/UUIDParam'
 *     responses:
 *       200:
 *         description: User suspended
 *       404:
 *         description: User not found
 */
router.put("/users/:id/suspend", asyncHandler(AdminController.suspendUser));

/**
 * @swagger
 * /admin/users/{id}/unsuspend:
 *   put:
 *     summary: Restore suspended user account
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/schemas/UUIDParam'
 *     responses:
 *       200:
 *         description: User unsuspended
 *       404:
 *         description: User not found
 */
router.put("/users/:id/unsuspend", asyncHandler(AdminController.unsuspendUser));

/**
 * @swagger
 * /admin/users/{id}/unlock:
 *   post:
 *     summary: Unlock a permanently or temporarily locked account
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/schemas/UUIDParam'
 *     responses:
 *       200:
 *         description: Account unlocked
 *       404:
 *         description: User not found
 */
router.post("/users/:id/unlock", asyncHandler(AdminController.unlockUser));

/**
 * @swagger
 * /admin/auth/rotate-keys:
 *   post:
 *     summary: Rotate JWT signing key pair (zero-downtime)
 *     description: >
 *       Generates a new RSA-256 key pair. The current key is demoted to
 *       "previous" and remains valid for 24 hours so existing tokens keep
 *       working. After 24 hours the previous key is rejected.
 *     tags: [Admin, Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Keys rotated — returns new and previous kid values
 *       403:
 *         description: Admin role required
 */
router.post("/auth/rotate-keys", asyncHandler(JwksController.rotateKeys));

/**
 * @swagger
 * /admin/transactions:
 *   get:
 *     summary: List all platform transactions
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: page
 *         in: query
 *         schema: { type: integer, default: 1 }
 *       - name: limit
 *         in: query
 *         schema: { type: integer, default: 50, maximum: 100 }
 *     responses:
 *       200:
 *         description: Paginated list of transactions
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       403:
 *         description: Admin role required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/transactions", asyncHandler(AdminController.listTransactions));

/**
 * @swagger
 * /admin/sessions:
 *   get:
 *     summary: List all sessions with optional status filter
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: limit
 *         in: query
 *         schema: { type: integer, default: 50 }
 *       - name: offset
 *         in: query
 *         schema: { type: integer, default: 0 }
 *       - name: status
 *         in: query
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Paginated list of sessions
 */
router.get("/sessions", asyncHandler(AdminController.listSessions));

/**
 * @swagger
 * /admin/payments:
 *   get:
 *     summary: List all payments with optional date range filter
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: limit
 *         in: query
 *         schema: { type: integer, default: 50 }
 *       - name: offset
 *         in: query
 *         schema: { type: integer, default: 0 }
 *       - name: startDate
 *         in: query
 *         schema: { type: string, format: date }
 *       - name: endDate
 *         in: query
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Paginated list of payments
 */
router.get("/payments", asyncHandler(AdminController.listPayments));

/**
 * @swagger
 * /admin/disputes:
 *   get:
 *     summary: List all disputes
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: page
 *         in: query
 *         schema: { type: integer, default: 1 }
 *       - name: limit
 *         in: query
 *         schema: { type: integer, default: 50 }
 *     responses:
 *       200:
 *         description: Paginated list of disputes
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       403:
 *         description: Admin role required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/disputes", asyncHandler(AdminController.listDisputes));

/**
 * @swagger
 * /admin/disputes/{id}/resolve:
 *   post:
 *     summary: Resolve or dismiss a dispute
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/schemas/UUIDParam'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ResolveDisputeRequest'
 *           example:
 *             status: resolved
 *             notes: Refund issued to mentee after review
 *     responses:
 *       200:
 *         description: Dispute resolved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       404:
 *         description: Dispute not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post(
  "/disputes/:id/resolve",
  asyncHandler(AdminController.resolveDispute),
);

/**
 * @swagger
 * /admin/system-health:
 *   get:
 *     summary: Get system health status
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: System health details
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         database: { type: string, enum: [healthy, degraded, down] }
 *                         stellar: { type: string, enum: [healthy, degraded, down] }
 *                         redis: { type: string, enum: [healthy, degraded, down] }
 *                         uptime: { type: number }
 */
router.get("/system-health", asyncHandler(AdminController.getSystemHealth));

/**
 * @swagger
 * /admin/logs:
 *   get:
 *     summary: Query audit logs
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: page
 *         in: query
 *         schema: { type: integer, default: 1 }
 *       - name: limit
 *         in: query
 *         schema: { type: integer, default: 50 }
 *       - name: action
 *         in: query
 *         schema: { type: string }
 *         description: Filter by audit action type
 *       - name: userId
 *         in: query
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Paginated audit logs
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       403:
 *         description: Admin role required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/logs", asyncHandler(AdminController.getLogs));

/**
 * @swagger
 * /admin/config:
 *   post:
 *     summary: Update a system configuration value
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateConfigRequest'
 *           example:
 *             key: platform.feePercentage
 *             value: 10
 *     responses:
 *       200:
 *         description: Configuration updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       403:
 *         description: Admin role required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post("/config", asyncHandler(AdminController.updateConfig));

// ── Audit Log Routes ─────────────────────────────────────────────────────────

/**
 * @swagger
 * /admin/audit-log:
 *   get:
 *     summary: Query audit logs with filtering and pagination
 *     tags: [Admin, Audit]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: page
 *         in: query
 *         schema: { type: integer, default: 1 }
 *       - name: limit
 *         in: query
 *         schema: { type: integer, default: 50 }
 *       - name: userId
 *         in: query
 *         schema: { type: string, format: uuid }
 *         description: Filter by user ID
 *       - name: action
 *         in: query
 *         schema: { type: string }
 *         description: Filter by action type
 *       - name: resourceType
 *         in: query
 *         schema: { type: string }
 *         description: Filter by resource type
 *       - name: startDate
 *         in: query
 *         schema: { type: string, format: date-time }
 *       - name: endDate
 *         in: query
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: Paginated audit logs
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 */
router.get("/audit-log", asyncHandler(AdminController.getAuditLogs));

/**
 * @swagger
 * /admin/audit-log/export:
 *   get:
 *     summary: Export audit logs as CSV for compliance reporting
 *     tags: [Admin, Audit]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: userId
 *         in: query
 *         schema: { type: string, format: uuid }
 *       - name: action
 *         in: query
 *         schema: { type: string }
 *       - name: resourceType
 *         in: query
 *         schema: { type: string }
 *       - name: startDate
 *         in: query
 *         schema: { type: string, format: date-time }
 *       - name: endDate
 *         in: query
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: CSV file download
 *         content:
 *           text/csv:
 *             schema:
 *               type: string
 */
router.get("/audit-log/export", asyncHandler(AdminController.exportAuditLogs));

/**
 * @swagger
 * /admin/audit-log/verify:
 *   get:
 *     summary: Verify audit log chain integrity
 *     tags: [Admin, Audit]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Chain integrity verification result
 */
router.get(
  "/audit-log/verify",
  asyncHandler(AdminController.verifyAuditLogIntegrity),
);

/**
 * @swagger
 * /admin/audit-log/stats:
 *   get:
 *     summary: Get audit log statistics
 *     tags: [Admin, Audit]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: startDate
 *         in: query
 *         schema: { type: string, format: date-time }
 *       - name: endDate
 *         in: query
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: Audit log statistics
 */
router.get("/audit-log/stats", asyncHandler(AdminController.getAuditLogStats));

// ── Analytics Routes ─────────────────────────────────────────────────────────

/**
 * @swagger
 * /admin/analytics/revenue:
 *   get:
 *     summary: Get revenue analytics
 *     tags: [Admin, Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: period
 *         in: query
 *         schema: { type: string, enum: [7d, 30d, 90d, 1y], default: 30d }
 *       - name: format
 *         in: query
 *         schema: { type: string, enum: [json, csv] }
 *     responses:
 *       200:
 *         description: Revenue analytics data
 */
router.get("/analytics/revenue", asyncHandler(AnalyticsController.getRevenue));

/**
 * @swagger
 * /admin/analytics/users:
 *   get:
 *     summary: Get user growth analytics
 *     tags: [Admin, Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: period
 *         in: query
 *         schema: { type: string, enum: [7d, 30d, 90d, 1y], default: 30d }
 *       - name: format
 *         in: query
 *         schema: { type: string, enum: [json, csv] }
 *     responses:
 *       200:
 *         description: User growth analytics data
 */
router.get("/analytics/users", asyncHandler(AnalyticsController.getUserGrowth));

/**
 * @swagger
 * /admin/analytics/sessions:
 *   get:
 *     summary: Get session analytics
 *     tags: [Admin, Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: period
 *         in: query
 *         schema: { type: string, enum: [7d, 30d, 90d, 1y], default: 30d }
 *       - name: format
 *         in: query
 *         schema: { type: string, enum: [json, csv] }
 *     responses:
 *       200:
 *         description: Session analytics data
 */
router.get(
  "/analytics/sessions",
  asyncHandler(AnalyticsController.getSessions),
);

/**
 * @swagger
 * /admin/analytics/top-mentors:
 *   get:
 *     summary: Get top mentors by revenue and sessions
 *     tags: [Admin, Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: limit
 *         in: query
 *         schema: { type: integer, default: 10 }
 *       - name: format
 *         in: query
 *         schema: { type: string, enum: [json, csv] }
 *     responses:
 *       200:
 *         description: Top mentors data
 */
router.get(
  "/analytics/top-mentors",
  asyncHandler(AnalyticsController.getTopMentors),
);

/**
 * @swagger
 * /admin/analytics/asset-distribution:
 *   get:
 *     summary: Get payment asset distribution
 *     tags: [Admin, Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: format
 *         in: query
 *         schema: { type: string, enum: [json, csv] }
 *     responses:
 *       200:
 *         description: Asset distribution data
 */
router.get(
  "/analytics/asset-distribution",
  asyncHandler(AnalyticsController.getAssetDistribution),
);

/**
 * @swagger
 * /admin/analytics/refresh:
 *   post:
 *     summary: Refresh analytics materialized views
 *     tags: [Admin, Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Views refreshed successfully
 */
router.post(
  "/analytics/refresh",
  asyncHandler(AnalyticsController.refreshViews),
);

/**
 * @swagger
 * /admin/reports/revenue:
 *   get:
 *     summary: Get platform revenue summary for a period
 *     tags: [Admin, Reporting]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: period
 *         in: query
 *         schema: { type: string, enum: [7d, 30d, 90d, 1y], default: 30d }
 *     responses:
 *       200:
 *         description: Revenue summary with period comparison
 */
router.get(
  "/reports/revenue",
  asyncHandler(RevenueReportController.getRevenueSummary),
);

/**
 * @swagger
 * /admin/reports/revenue/daily:
 *   get:
 *     summary: Get daily revenue time series
 *     tags: [Admin, Reporting]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: from
 *         in: query
 *         required: true
 *         schema: { type: string, format: date }
 *       - name: to
 *         in: query
 *         required: true
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Daily revenue report
 */
router.get(
  "/reports/revenue/daily",
  asyncHandler(RevenueReportController.getDailyRevenue),
);

/**
 * @swagger
 * /admin/reports/transactions:
 *   get:
 *     summary: Get filterable transaction report
 *     tags: [Admin, Reporting]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: status
 *         in: query
 *         schema: { type: string }
 *       - name: from
 *         in: query
 *         required: true
 *         schema: { type: string, format: date }
 *       - name: to
 *         in: query
 *         required: true
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Transaction report list
 */
router.get(
  "/reports/transactions",
  asyncHandler(RevenueReportController.getTransactions),
);

/**
 * @swagger
 * /admin/reports/export:
 *   get:
 *     summary: Export report data as CSV
 *     tags: [Admin, Reporting]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: type
 *         in: query
 *         schema: { type: string, enum: [revenue], default: revenue }
 *       - name: format
 *         in: query
 *         schema: { type: string, enum: [csv], default: csv }
 *       - name: from
 *         in: query
 *         schema: { type: string, format: date }
 *       - name: to
 *         in: query
 *         schema: { type: string, format: date }
 *       - name: status
 *         in: query
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: CSV export generated
 */
router.get(
  "/reports/export",
  asyncHandler(RevenueReportController.exportReport),
);

// ── Moderation Routes ────────────────────────────────────────────────────────

/**
 * @swagger
 * /admin/moderation/queue:
 *   get:
 *     summary: Get moderation queue
 *     tags: [Admin, Moderation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: limit
 *         in: query
 *         schema: { type: integer, default: 50 }
 *       - name: offset
 *         in: query
 *         schema: { type: integer, default: 0 }
 *     responses:
 *       200:
 *         description: Moderation queue items
 */
router.get("/moderation/queue", asyncHandler(ModerationController.getQueue));

/**
 * @swagger
 * /admin/moderation/{id}/approve:
 *   put:
 *     summary: Approve flagged content
 *     tags: [Admin, Moderation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               notes: { type: string }
 *     responses:
 *       200:
 *         description: Content approved
 */
router.put(
  "/moderation/:id/approve",
  asyncHandler(ModerationController.approveContent),
);

/**
 * @swagger
 * /admin/moderation/{id}/reject:
 *   put:
 *     summary: Reject flagged content
 *     tags: [Admin, Moderation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               notes: { type: string }
 *     responses:
 *       200:
 *         description: Content rejected
 */
router.put(
  "/moderation/:id/reject",
  asyncHandler(ModerationController.rejectContent),
);

/**
 * @swagger
 * /admin/moderation/{id}/escalate:
 *   put:
 *     summary: Escalate flag to senior admin
 *     tags: [Admin, Moderation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               notes: { type: string }
 *     responses:
 *       200:
 *         description: Flag escalated
 */
router.put(
  "/moderation/:id/escalate",
  asyncHandler(ModerationController.escalateFlag),
);

/**
 * @swagger
 * /admin/moderation/stats:
 *   get:
 *     summary: Get moderation statistics
 *     tags: [Admin, Moderation]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Moderation statistics
 */
router.get("/moderation/stats", asyncHandler(ModerationController.getStats));

// ── Verification Routes ──────────────────────────────────────────────────────

/**
 * @swagger
 * /admin/verifications:
 *   get:
 *     summary: List all mentor verification submissions
 *     tags: [Admin, Verification]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: status
 *         in: query
 *         schema: { type: string, enum: [pending, approved, rejected, more_info_requested, expired] }
 *       - name: page
 *         in: query
 *         schema: { type: integer, default: 1 }
 *       - name: limit
 *         in: query
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Paginated list of verifications
 */
router.get(
  "/verifications",
  validate(listVerificationsSchema),
  asyncHandler(VerificationController.listVerifications),
);

/**
 * @swagger
 * /admin/verifications/{id}/approve:
 *   put:
 *     summary: Approve a mentor verification
 *     tags: [Admin, Verification]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Verification approved
 */
router.put(
  "/verifications/:id/approve",
  asyncHandler(VerificationController.approve),
);

/**
 * @swagger
 * /admin/verifications/{id}/reject:
 *   put:
 *     summary: Reject a mentor verification
 *     tags: [Admin, Verification]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason: { type: string, minLength: 10 }
 *     responses:
 *       200:
 *         description: Verification rejected
 */
router.put(
  "/verifications/:id/reject",
  validate(rejectVerificationSchema),
  asyncHandler(VerificationController.reject),
);

/**
 * @swagger
 * /admin/verifications/{id}/request-more:
 *   put:
 *     summary: Request additional documents from mentor
 *     tags: [Admin, Verification]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               message: { type: string, minLength: 10 }
 *     responses:
 *       200:
 *         description: Additional info requested
 */
router.put(
  "/verifications/:id/request-more",
  validate(requestMoreInfoSchema),
  asyncHandler(VerificationController.requestMoreInfo),
);

/**
 * @swagger
 * /api/v1/admin/consent/stats:
 *   get:
 *     summary: Aggregate consent rates by type (Admin only)
 *     tags: [Consent, Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Consent statistics aggregated successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Admin access required
 */
router.get(
  "/consent/stats",
  authenticate,
  requireAdmin,
  asyncHandler(ConsentController.getConsentStats),
);

export default router;
