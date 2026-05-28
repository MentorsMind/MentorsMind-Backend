import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.utils";
import { authenticate } from "../middleware/auth.middleware";
import { ModerationController } from "../controllers/moderation.controller";

const router = Router();

// ── All user moderation routes require authentication ─────────────────────────
router.use(authenticate);

/**
 * @swagger
 * /api/v1/user/moderation/flags/{id}/appeal:
 *   post:
 *     summary: Submit an appeal for a rejected flag
 *     tags: [Moderation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason: { type: string }
 */
router.post(
  "/flags/:id/appeal",
  asyncHandler(ModerationController.submitAppeal),
);

export default router;
