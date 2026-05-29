import { Router } from "express";
import { ModerationController } from "../controllers/moderation.controller";
import { asyncHandler } from "../utils/asyncHandler.utils";

const router = Router();

// Add DELETE endpoint for flag deletion
router.delete("/:id", asyncHandler(ModerationController.deleteFlag));

import { asyncHandler } from "../utils/asyncHandler.utils";
import { authenticate } from "../middleware/auth.middleware";
import { requireAdmin } from "../middleware/admin-auth.middleware";
import { ModerationController } from "../controllers/moderation.controller";

const router = Router();

// ── All moderation routes require authentication + admin role ─────────────────
router.use(authenticate, requireAdmin);

/**
 * @swagger
 * /api/v1/admin/moderation/queue:
 *   get:
 *     summary: Get the manual moderation queue (human-flagged content)
 *     tags: [Moderation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0 }
 *     responses:
 *       200:
 *         description: Paginated moderation queue
 */
router.get("/queue", asyncHandler(ModerationController.getQueue));

/**
 * @swagger
 * /api/v1/admin/moderation/ai-queue:
 *   get:
 *     summary: Get AI-flagged items awaiting human review
 *     tags: [Moderation]
 *     security:
 *       - bearerAuth: []
 */
router.get("/ai-queue", asyncHandler(ModerationController.getAIQueue));

/**
 * @swagger
 * /api/v1/admin/moderation/stats:
 *   get:
 *     summary: Get moderation statistics
 *     tags: [Moderation]
 *     security:
 *       - bearerAuth: []
 */
router.get("/stats", asyncHandler(ModerationController.getStats));

/**
 * @swagger
 * /api/v1/admin/moderation/scan:
 *   post:
 *     summary: Manually trigger an AI scan on arbitrary text (admin tool)
 *     tags: [Moderation]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [contentId, contentType, text]
 *             properties:
 *               contentId:  { type: string }
 *               contentType: { type: string, enum: [profile, review, message] }
 *               text:       { type: string }
 */
router.post("/scan", asyncHandler(ModerationController.triggerAIScan));

/**
 * @swagger
 * /api/v1/admin/moderation/{id}/approve:
 *   put:
 *     summary: Approve flagged content (keep visible)
 *     tags: [Moderation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 */
router.put("/:id/approve", asyncHandler(ModerationController.approveContent));

/**
 * @swagger
 * /api/v1/admin/moderation/{id}/reject:
 *   put:
 *     summary: Reject flagged content (remove + notify author)
 *     tags: [Moderation]
 *     security:
 *       - bearerAuth: []
 */
router.put("/:id/reject", asyncHandler(ModerationController.rejectContent));

/**
 * @swagger
 * /api/v1/admin/moderation/{id}/escalate:
 *   put:
 *     summary: Escalate flag to senior admin
 *     tags: [Moderation]
 *     security:
 *       - bearerAuth: []
 */
router.put("/:id/escalate", asyncHandler(ModerationController.escalateFlag));

/**
 * @swagger
 * /api/v1/admin/moderation/{id}:
 *   delete:
 *     summary: Delete a resolved flag
 *     tags: [Moderation]
 *     security:
 *       - bearerAuth: []
 */
router.delete("/:id", asyncHandler(ModerationController.deleteFlag));

// ── Appeals ──────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/admin/moderation/appeals:
 *   get:
 *     summary: Get appeals queue
 *     tags: [Moderation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0 }
 *       - in: query
 *         name: status
 *         schema: { type: string, default: pending }
 *     responses:
 *       200:
 *         description: Paginated appeals queue
 */
router.get("/appeals", asyncHandler(ModerationController.getAppeals));

/**
 * @swagger
 * /api/v1/admin/moderation/appeals/{id}/resolve:
 *   put:
 *     summary: Resolve an appeal
 *     tags: [Moderation]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [approved, rejected] }
 *               notes:  { type: string }
 */
router.put(
  "/appeals/:id/resolve",
  asyncHandler(ModerationController.resolveAppeal),
);

export default router;
