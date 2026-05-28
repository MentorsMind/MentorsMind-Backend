import { Router } from "express";
import { CalendarSyncController } from "../controllers/calendar-sync.controller";
import { authenticate } from "../middleware/auth.middleware";
import { asyncHandler } from "../utils/asyncHandler.utils";

const router = Router();

/**
 * @swagger
 * /calendar/sync/integrations:
 *   get:
 *     summary: List all calendar integrations for the authenticated user
 *     tags: [Calendar]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of integrations
 */
router.get(
  "/integrations",
  authenticate,
  asyncHandler(CalendarSyncController.listIntegrations),
);

/**
 * @swagger
 * /calendar/sync/{provider}/toggle:
 *   patch:
 *     summary: Enable or disable sync for a calendar provider
 *     tags: [Calendar]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: provider
 *         required: true
 *         schema: { type: string, enum: [google, outlook, apple] }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [enabled]
 *             properties:
 *               enabled: { type: boolean }
 *     responses:
 *       200:
 *         description: Sync toggled
 */
router.patch(
  "/:provider/toggle",
  authenticate,
  asyncHandler(CalendarSyncController.toggleSync),
);

/**
 * @swagger
 * /calendar/sync/{provider}:
 *   delete:
 *     summary: Disconnect a calendar provider
 *     tags: [Calendar]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: provider
 *         required: true
 *         schema: { type: string, enum: [google, outlook, apple] }
 *     responses:
 *       200:
 *         description: Disconnected
 */
router.delete(
  "/:provider",
  authenticate,
  asyncHandler(CalendarSyncController.disconnect),
);

// ── Outlook OAuth ─────────────────────────────────────────────────────────────

/**
 * @swagger
 * /calendar/sync/outlook/connect:
 *   get:
 *     summary: Redirect to Microsoft OAuth consent screen
 *     tags: [Calendar]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       302:
 *         description: Redirect to Microsoft
 */
router.get(
  "/outlook/connect",
  authenticate,
  asyncHandler(CalendarSyncController.outlookConnect),
);

/**
 * @swagger
 * /calendar/sync/outlook/callback:
 *   get:
 *     summary: Microsoft OAuth callback
 *     tags: [Calendar]
 *     responses:
 *       302:
 *         description: Redirect to client app
 */
router.get(
  "/outlook/callback",
  asyncHandler(CalendarSyncController.outlookCallback),
);

// ── Apple CalDAV ──────────────────────────────────────────────────────────────

/**
 * @swagger
 * /calendar/sync/apple/connect:
 *   post:
 *     summary: Connect Apple Calendar via CalDAV (app-specific password)
 *     tags: [Calendar]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [apple_id, app_password]
 *             properties:
 *               apple_id: { type: string }
 *               app_password: { type: string }
 *     responses:
 *       200:
 *         description: Connected
 *       401:
 *         description: Invalid credentials
 */
router.post(
  "/apple/connect",
  authenticate,
  asyncHandler(CalendarSyncController.appleConnect),
);

export default router;
