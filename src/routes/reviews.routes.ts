import { Router, IRouter } from "express";
import { ModerationController } from "../controllers/moderation.controller";
import { authenticate } from "../middleware/auth.middleware";
import { asyncHandler } from "../utils/asyncHandler.utils";

const router: IRouter = Router();

/**
 * @swagger
 * /reviews/{id}/flag:
 *   post:
 *     summary: Flag a review for moderation
 *     tags: [Reviews, Moderation]
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
 *       201:
 *         description: Review flagged successfully
 *       401:
 *         description: Authentication required
 */
router.post(
  "/:id/flag",
  authenticate,
  asyncHandler(ModerationController.flagReview),
);

export default router;
