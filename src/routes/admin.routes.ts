import { Router } from "express";
import backupRoutes from "./admin/backup.routes";
import databasePerformanceRoutes from "./admin/database-performance.routes";
import { AdminController } from "../controllers/admin.controller";
import { AdvancedAnalyticsController } from "../controllers/advanced-analytics.controller";
import { VerificationController } from "../controllers/verification.controller";
import { RevenueReportController } from "../controllers/revenueReport.controller";
import { JwksController } from "../controllers/jwks.controller";
import { RecordingCleanupController } from "../controllers/recording-cleanup.controller";
import { AnalyticsRefreshStatusController } from "../controllers/analytics-refresh-status.controller";
import { ExportAdminController } from "../controllers/export-progress.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireAdmin } from "../middleware/admin-auth.middleware";
import { validate } from "../middleware/validation.middleware";
import { asyncHandler } from "../utils/asyncHandler.utils";
import { adminAllowlistMiddleware as _adminAllowlistMiddleware } from "../middleware/ipFilter.middleware";
import { auditLogMiddleware } from "../middleware/audit-log.middleware";
import { AuditAction } from "../utils/log-formatter.utils";
import {
  rejectVerificationSchema,
  requestMoreInfoSchema,
  listVerificationsSchema,
} from "../validators/schemas/verification.schemas";
import { ConsentController } from "../controllers/consent.controller";
import { MentorQualityController } from "../controllers/mentor-quality.controller";
import { TraceController } from "../controllers/trace.controller";
import { EscrowController } from "../controllers/escrow.controller";
import { BackgroundCheckController } from "../controllers/background-check.controller";
import { WalletReconciliationController } from "../controllers/wallet-reconciliation.controller";
import { WebhookEventsController } from "../controllers/webhook-events.controller";
import { getTraceSchema } from "../validators/schemas/trace.schemas";
import {
  listAdminUsersSchema,
  updateUserStatusSchema,
  updateUserTierSchema,
  suspendUserSchema,
  banUserSchema,
  adminIdParamSchema,
  listAdminTransactionsSchema,
  listAdminSessionsSchema,
  listAdminPaymentsSchema,
  listAdminDisputesSchema,
  resolveDisputeSchema,
  getAdminLogsSchema,
  updateConfigSchema,
  getAuditLogSchema,
  exportAuditLogSchema,
  auditLogStatsSchema,
  previewEmailTemplateSchema,
  revenueSummarySchema,
  dailyRevenueSchema,
  transactionReportSchema,
  exportReportSchema,
  addBlocklistRuleSchema,
  removeBlocklistRuleSchema,
  addAllowlistRuleSchema,
  approveVerificationSchema,
  retryWebhookDeliverySchema,
} from "../validators/schemas/admin.schemas";

const router = Router();

router.use(authenticate);
router.use(requireAdmin);
// adminAllowlistMiddleware is now applied globally in v1/index.ts for /admin/*

router.post(
  "/background-checks/webhook",
  asyncHandler(BackgroundCheckController.handleWebhook),
);

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

/** GET /admin/mentors/quality — paginated/sortable/filterable mentor quality scores */
router.get("/mentors/quality", MentorQualityController.list);

/**
 * @swagger
 * /admin/trace/{traceId}:
 *   get:
 *     summary: Query Jaeger for the full trace by traceId
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  "/trace/:traceId",
  validate(getTraceSchema),
  asyncHandler(TraceController.getTrace),
);

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
router.get("/users", validate(listAdminUsersSchema), asyncHandler(AdminController.listUsers));

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
router.put(
  "/users/:id/status",
  validate(updateUserStatusSchema),
  auditLogMiddleware({
    action: AuditAction.ADMIN_ACTION,
    getEntityDetails: (req) => ({ type: "USER", id: req.params.id as string }),
  }),
  asyncHandler(AdminController.updateUserStatus),
);

/**
 * @swagger
 * /admin/users/{id}/tier:
 *   put:
 *     summary: Update user tier
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
 *             type: object
 *             properties:
 *               tier:
 *                 type: string
 *                 enum: [free, pro, enterprise]
 *     responses:
 *       200:
 *         description: User tier updated
 */
router.put(
  "/users/:id/tier",
  validate(updateUserTierSchema),
  auditLogMiddleware({
    action: AuditAction.ADMIN_ACTION,
    getEntityDetails: (req) => ({ type: "USER", id: req.params.id as string }),
  }),
  asyncHandler(AdminController.updateUserTier),
);

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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason:
 *                 type: string
 *                 description: Reason for the suspension
 *                 example: "Repeated policy violations"
 *               expiresAt:
 *                 type: string
 *                 format: date-time
 *                 description: Optional expiry date (omit for indefinite suspension)
 *                 example: "2026-06-30T00:00:00Z"
 *     responses:
 *       200:
 *         description: User suspended
 *       400:
 *         description: Reason is required
 *       404:
 *         description: User not found
 */
router.put(
  "/users/:id/suspend",
  validate(suspendUserSchema),
  auditLogMiddleware({
    action: AuditAction.ADMIN_ACTION,
    getEntityDetails: (req) => ({ type: "USER", id: req.params.id as string }),
  }),
  asyncHandler(AdminController.suspendUser),
);

/**
 * @swagger
 * /admin/users/{id}/ban:
 *   put:
 *     summary: Permanently ban a user account
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
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason:
 *                 type: string
 *                 description: Reason for the permanent ban
 *                 example: "Fraud and abuse of platform"
 *     responses:
 *       200:
 *         description: User permanently banned
 *       400:
 *         description: Reason is required
 *       404:
 *         description: User not found
 */
router.put(
  "/users/:id/ban",
  validate(banUserSchema),
  auditLogMiddleware({
    action: AuditAction.ADMIN_ACTION,
    getEntityDetails: (req) => ({ type: "USER", id: req.params.id as string }),
  }),
  asyncHandler(AdminController.banUser),
);

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
router.put(
  "/users/:id/unsuspend",
  validate(adminIdParamSchema),
  auditLogMiddleware({
    action: AuditAction.ADMIN_ACTION,
    getEntityDetails: (req) => ({ type: "USER", id: req.params.id as string }),
  }),
  asyncHandler(AdminController.unsuspendUser),
);

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
router.post(
  "/users/:id/unlock",
  validate(adminIdParamSchema),
  auditLogMiddleware({
    action: AuditAction.ADMIN_ACTION,
    getEntityDetails: (req) => ({ type: "USER", id: req.params.id as string }),
  }),
  asyncHandler(AdminController.unlockUser),
);

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
router.post(
  "/auth/rotate-keys",
  auditLogMiddleware({
    action: AuditAction.ADMIN_ACTION,
    getEntityDetails: () => ({ type: "AUTH", id: "JWKS" }),
  }),
  asyncHandler(JwksController.rotateKeys),
);
router.post(
  "/jwks/rotate",
  auditLogMiddleware({
    action: AuditAction.ADMIN_ACTION,
    getEntityDetails: () => ({ type: "AUTH", id: "JWKS" }),
  }),
  asyncHandler(JwksController.rotateKeys),
);
router.post(
  "/security/rotate-encryption-key",
  auditLogMiddleware({
    action: AuditAction.ADMIN_ACTION,
    getEntityDetails: () => ({ type: "SECURITY", id: "ENCRYPTION" }),
  }),
  asyncHandler(AdminController.rotateEncryptionKey),
);
router.get(
  "/deletion-requests",
  asyncHandler(AdminController.listDeletionRequests),
);
router.post(
  "/deletion-requests/retry",
  auditLogMiddleware({
    action: AuditAction.ADMIN_ACTION,
    getEntityDetails: () => ({ type: "SYSTEM", id: "DELETION_RETRY" }),
  }),
  asyncHandler(AdminController.retryFailedDeletions),
);

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
router.get("/transactions", validate(listAdminTransactionsSchema), asyncHandler(AdminController.listTransactions));

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
router.get("/sessions", validate(listAdminSessionsSchema), asyncHandler(AdminController.listSessions));

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
router.get("/payments", validate(listAdminPaymentsSchema), asyncHandler(AdminController.listPayments));

/** GET /admin/payments/reconciliation — list Stripe/Stellar mismatch review queue */
router.get("/payments/reconciliation", asyncHandler(AdminController.listPaymentReconciliations));

/** PATCH /admin/payments/reconciliation/:id/review — update discrepancy review status */
router.patch(
  "/payments/reconciliation/:id/review",
  asyncHandler(AdminController.reviewPaymentReconciliation),
);

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
router.get("/disputes", validate(listAdminDisputesSchema), asyncHandler(AdminController.listDisputes));

/**
 * @swagger
 * /admin/escrow/pending-releases:
 *   get:
 *     summary: List pending escrow auto-releases
 *     tags: [Admin, Escrow]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of pending auto-releases
 */
router.get("/escrow/pending-releases", asyncHandler(EscrowController.getPendingReleases));

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
  validate(resolveDisputeSchema),
  auditLogMiddleware({
    action: AuditAction.ADMIN_ACTION,
    getEntityDetails: (req) => ({ type: "DISPUTE", id: req.params.id as string }),
  }),
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
router.get("/logs", validate(getAdminLogsSchema), asyncHandler(AdminController.getLogs));

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
router.post("/config", validate(updateConfigSchema), asyncHandler(AdminController.updateConfig));

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
router.get("/audit-log", validate(getAuditLogSchema), asyncHandler(AdminController.getAuditLogs));

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
router.get("/audit-log/export", validate(exportAuditLogSchema), asyncHandler(AdminController.exportAuditLogs));

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
router.get("/audit-log/stats", validate(auditLogStatsSchema), asyncHandler(AdminController.getAuditLogStats));

/**
 * @swagger
 * /admin/audit-log/archives:
 *   get:
 *     summary: List S3-archived audit log batches with presigned download links
 *     tags: [Admin, Audit]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: page
 *         in: query
 *         schema: { type: integer, default: 1 }
 *       - name: limit
 *         in: query
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Paginated audit log archives
 */
router.get("/audit-log/archives", asyncHandler(AdminController.getAuditLogArchives));

// ── Email Template Routes ──────────────────────────────────────────────────────

/**
 * @swagger
 * /admin/email/preview/{template}:
 *   post:
 *     summary: Preview rendered email template
 *     description: Render an email template with sample data for preview purposes
 *     tags: [Admin, Email]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: template
 *         in: path
 *         required: true
 *         schema: { type: string }
 *         description: Template name (e.g., welcome, booking-confirmed, payment-received)
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: true
 *           example:
 *             userName: "John Doe"
 *             mentorName: "Jane Smith"
 *             sessionDate: "2024-03-15"
 *             sessionTime: "10:00 AM"
 *     responses:
 *       200:
 *         description: Rendered template preview
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
 *                         template: { type: string }
 *                         subject: { type: string }
 *                         html: { type: string }
 *                         text: { type: string }
 *       400:
 *         description: Template name is required
 *       500:
 *         description: Failed to render template
 */
router.post(
  "/email/preview/:template",
  validate(previewEmailTemplateSchema),
  asyncHandler(AdminController.previewEmailTemplate),
);

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
router.get("/analytics/revenue", AdvancedAnalyticsController.getRevenue);

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
router.get("/analytics/users", AdvancedAnalyticsController.getUsers);

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
router.get("/analytics/sessions", AdvancedAnalyticsController.getSessions);

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
// router.get(
//   "/analytics/top-mentors",
//   asyncHandler(AnalyticsController.getTopMentors),
// );

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
// router.get(
//   "/analytics/asset-distribution",
//   asyncHandler(AnalyticsController.getAssetDistribution),
// );

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
router.post("/analytics/refresh", AdvancedAnalyticsController.refreshAnalytics);

/**
 * @swagger
 * /admin/analytics/refresh-status:
 *   get:
 *     summary: Per-view analytics refresh health and last-run times
 *     description: >
 *       Shows the current state of each PostgreSQL materialized view managed
 *       by the analytics refresh coordinator — last refreshed timestamp,
 *       current lock holder, whether the view is stale, and BullMQ queue depth.
 *     tags: [Admin, Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Refresh status per view
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
 *                         views:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               viewName: { type: string }
 *                               status: { type: string, enum: [idle, refreshing, failed, unknown] }
 *                               lastRefreshedAt: { type: string, format: date-time, nullable: true }
 *                               secondsSinceRefresh: { type: integer, nullable: true }
 *                               isStale: { type: boolean }
 *                               lastDurationMs: { type: integer, nullable: true }
 *                         queue:
 *                           type: object
 *                           properties:
 *                             waiting: { type: integer }
 *                             active: { type: integer }
 *                             delayed: { type: integer }
 *                             failed: { type: integer }
 *                         summary:
 *                           type: object
 *                           properties:
 *                             total: { type: integer }
 *                             idle: { type: integer }
 *                             refreshing: { type: integer }
 *                             failed: { type: integer }
 *                             stale: { type: integer }
 *       403:
 *         description: Admin role required
 */
router.get(
  "/analytics/refresh-status",
  asyncHandler(AnalyticsRefreshStatusController.getRefreshStatus),
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
  validate(revenueSummarySchema),
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
  validate(dailyRevenueSchema),
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
  validate(transactionReportSchema),
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
router.get("/reports/export", validate(exportReportSchema), asyncHandler(AdminController.exportAuditLogs));

// ── Security Management Routes ───────────────────────────────────────────────

/**
 * @swagger
 * /admin/security/blocklist:
 *   get:
 *     summary: List all blocked IP ranges
 *     tags: [Admin, Security]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of blocked IP rules
 *   post:
 *     summary: Add an IP or CIDR to the global blocklist
 *     tags: [Admin, Security]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               ipRange: { type: string, example: "1.2.3.4" }
 *               reason: { type: string, example: "Suspicious activity" }
 *     responses:
 *       201:
 *         description: IP rule created
 */
router.get(
  "/security/blocklist",
  asyncHandler(AdminController.listBlocklistRules),
);
router.post(
  "/security/blocklist",
  validate(addBlocklistRuleSchema),
  asyncHandler(AdminController.addBlocklistRule),
);

/**
 * @swagger
 * /admin/security/blocklist/{id}:
 *   delete:
 *     summary: Remove an IP rule from the blocklist
 *     tags: [Admin, Security]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: IP rule removed
 */
router.delete(
  "/security/blocklist/:id",
  validate(removeBlocklistRuleSchema),
  asyncHandler(AdminController.removeBlocklistRule),
);

/**
 * @swagger
 * /admin/security/allowlist:
 *   post:
 *     summary: Add an IP or CIDR to the admin allowlist
 *     tags: [Admin, Security]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               ipRange: { type: string, example: "127.0.0.1" }
 *               reason: { type: string, example: "Admin office VPN" }
 *     responses:
 *       201:
 *         description: Admin allowlist rule added
 */
router.post(
  "/security/allowlist",
  validate(addAllowlistRuleSchema),
  asyncHandler(AdminController.addAdminAllowlistRule),
);

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
  "/verifications/expiring-soon",
  asyncHandler(VerificationController.listExpiringSoon),
);

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
  validate(approveVerificationSchema),
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
 * /admin/webhooks/:deliveryId/retry:
 *   post:
 *     summary: Manually retry a failed webhook delivery
 *     tags: [Admin, Webhooks]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: deliveryId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Retry scheduled successfully
 *       400:
 *         description: Cannot retry (already succeeded, max retries exceeded, etc.)
 *       404:
 *         description: Delivery not found
 */
router.post(
  "/webhooks/:deliveryId/retry",
  validate(retryWebhookDeliverySchema),
  auditLogMiddleware({
    action: AuditAction.ADMIN_ACTION,
    getEntityDetails: (req) => ({
      type: "WEBHOOK_DELIVERY",
      id: req.params.deliveryId as string,
    }),
  }),
  asyncHandler(AdminController.retryWebhookDelivery),
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

router.use("/backup", backupRoutes);
router.use("/database", databasePerformanceRoutes);

// ── Recording Cleanup Routes ─────────────────────────────────────────────────

/**
 * @swagger
 * /admin/recordings/cleanup-report:
 *   get:
 *     summary: Latest S3 recording cleanup stats
 *     description: >
 *       Returns the most recent cleanup job run report — orphans found,
 *       bytes reclaimed, estimated monthly cost savings, and multipart
 *       uploads aborted. Pass ?limit=N (max 20) to see the last N runs.
 *     tags: [Admin, Recordings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: limit
 *         in: query
 *         schema: { type: integer, default: 1, maximum: 20 }
 *         description: Number of job runs to return (default 1 = latest only)
 *     responses:
 *       200:
 *         description: Cleanup report
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
 *                         jobRunId: { type: string, format: uuid }
 *                         ranAt: { type: string, format: date-time }
 *                         orphansFound: { type: integer }
 *                         pendingDeletion: { type: integer }
 *                         hardDeleted: { type: integer }
 *                         recovered: { type: integer }
 *                         multipartUploadsAborted: { type: integer }
 *                         bytesReclaimed: { type: integer }
 *                         bytesPendingReclaim: { type: integer }
 *                         estimatedMonthlySavingsUsd: { type: number }
 *       403:
 *         description: Admin role required
 */
router.get(
  "/recordings/cleanup-report",
  asyncHandler(RecordingCleanupController.getCleanupReport),
);

/**
 * @swagger
 * /admin/recordings/cleanup-run:
 *   post:
 *     summary: Trigger an immediate recording cleanup run
 *     description: Enqueues a high-priority cleanup job without waiting for the Saturday cron.
 *     tags: [Admin, Recordings]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       202:
 *         description: Job queued
 *       403:
 *         description: Admin role required
 */
router.post(
  "/recordings/cleanup-run",
  auditLogMiddleware({
    action: AuditAction.ADMIN_ACTION,
    getEntityDetails: () => ({ type: "RECORDING_CLEANUP", id: "manual-trigger" }),
  }),
  asyncHandler(RecordingCleanupController.triggerCleanupRun),
);

/**
 * @swagger
 * /admin/recordings/cleanup-recover:
 *   post:
 *     summary: Recover a recording object pending deletion
 *     description: >
 *       Marks a pending-deletion log entry as recovered within the 7-day
 *       soft-delete window, preventing the object from being hard-deleted.
 *     tags: [Admin, Recordings]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [logId]
 *             properties:
 *               logId:
 *                 type: string
 *                 format: uuid
 *                 description: The recording_cleanup_log row ID
 *     responses:
 *       200:
 *         description: Object recovered
 *       400:
 *         description: logId is required
 *       404:
 *         description: Log entry not found or not in pending_deletion state
 *       403:
 *         description: Admin role required
 */
router.post(
  "/recordings/cleanup-recover",
  auditLogMiddleware({
    action: AuditAction.ADMIN_ACTION,
    getEntityDetails: (req) => ({
      type: "RECORDING_CLEANUP",
      id: req.body.logId as string,
    }),
  }),
  asyncHandler(RecordingCleanupController.recoverPendingDeletion),
);

// ── Export Admin Routes ──────────────────────────────────────────────────────

/**
 * @swagger
 * /admin/exports/pending-approvals:
 *   get:
 *     summary: List data export requests awaiting admin approval (>1 GB)
 *     tags: [Admin, Export]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of export jobs pending approval
 */
router.get(
  "/exports/pending-approvals",
  asyncHandler(ExportAdminController.listPendingApprovals),
);

/**
 * @swagger
 * /admin/exports/{jobId}/approve:
 *   post:
 *     summary: Approve a large export request and re-queue it
 *     tags: [Admin, Export]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: jobId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Export approved and queued
 *       400:
 *         description: Export is not awaiting approval
 *       404:
 *         description: Export job not found
 */
router.post(
  "/exports/:jobId/approve",
  auditLogMiddleware({
    action: AuditAction.ADMIN_ACTION,
    getEntityDetails: (req) => ({ type: "EXPORT_JOB", id: req.params.jobId as string }),
  }),
  asyncHandler(ExportAdminController.approveExport),
);

/**
 * @swagger
 * /admin/exports/{jobId}/reject:
 *   post:
 *     summary: Reject a large export request
 *     tags: [Admin, Export]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: jobId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason: { type: string }
 *     responses:
 *       200:
 *         description: Export rejected
 */
router.post(
  "/exports/:jobId/reject",
  auditLogMiddleware({
    action: AuditAction.ADMIN_ACTION,
    getEntityDetails: (req) => ({ type: "EXPORT_JOB", id: req.params.jobId as string }),
  }),
  asyncHandler(ExportAdminController.rejectExport),
);

/**
 * @swagger
 * /admin/stellar/stuck-transactions:
 *   get:
 *     summary: Retrieve stuck stellar transactions
 *     tags: [Admin, Stellar]
 *     responses:
 *       200:
 *         description: Stuck transactions retrieved
 */
router.get(
  "/stellar/stuck-transactions",
  asyncHandler(AdminController.getStuckStellarTransactions),
);

export default router;

// ─── Admin Impersonation (issue #750) ─────────────────────────────────────────

/**
 * @swagger
 * /admin/users/{id}/impersonate:
 *   post:
 *     summary: Start an admin impersonation session for a user
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Target user ID to impersonate
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason:
 *                 type: string
 *                 minLength: 1
 *                 description: Business reason for impersonating this user
 *           example:
 *             reason: "Debugging reported UI bug in booking flow"
 *     responses:
 *       200:
 *         description: Impersonation session started; contains a 15-minute JWT
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
 *                         token:
 *                           type: string
 *                         sessionId:
 *                           type: string
 *                           format: uuid
 *                         expiresAt:
 *                           type: string
 *                           format: date-time
 *                         targetUser:
 *                           type: object
 *       400:
 *         description: Missing reason or invalid target user
 *       403:
 *         description: Cannot impersonate another admin
 *       404:
 *         description: Target user not found
 */
router.post(
  "/users/:id/impersonate",
  auditLogMiddleware({
    action: AuditAction.ADMIN_ACTION,
    getEntityDetails: (req) => ({ type: "USER", id: req.params.id as string }),
  }),
  asyncHandler(AdminController.startImpersonation),
);

/**
 * @swagger
 * /admin/impersonation/{sessionId}:
 *   delete:
 *     summary: Explicitly end an active impersonation session
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Impersonation session ID to end
 *     responses:
 *       200:
 *         description: Impersonation session ended
 *       404:
 *         description: Session not found or already ended
 */
router.delete(
  "/impersonation/:sessionId",
  auditLogMiddleware({
    action: AuditAction.ADMIN_ACTION,
    getEntityDetails: (req) => ({ type: "IMPERSONATION_SESSION", id: req.params.sessionId as string }),
  }),
  asyncHandler(AdminController.endImpersonation),
);

/**
 * @swagger
 * /admin/impersonation:
 *   get:
 *     summary: List active impersonation sessions for the calling admin
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of active impersonation sessions
 */
router.get("/impersonation", asyncHandler(AdminController.listActiveImpersonations));

/**
 * @swagger
 * /admin/wallets/{id}/sync:
 *   post:
 *     summary: Reconcile a wallet's stored balances against the Stellar network
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string }
 *         description: Wallet ID (wallets.id)
 *     responses:
 *       200:
 *         description: Reconciliation result with per-asset deltas
 *       404:
 *         description: Wallet not found
 *       502:
 *         description: Reconciliation failed (e.g. Horizon unreachable)
 */
router.post(
  "/wallets/:id/sync",
  asyncHandler(WalletReconciliationController.syncWallet),
);

// Inbound webhook idempotency admin (issue #979)
router.get(
  "/webhooks/events",
  asyncHandler(WebhookEventsController.list),
);
router.post(
  "/webhooks/events/:id/replay",
  asyncHandler(WebhookEventsController.replay),
);
