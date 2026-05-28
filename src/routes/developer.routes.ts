import { Router } from "express";
import { ApiKeyController } from "../controllers/api-key.controller";
import { authenticate } from "../middleware/auth.middleware";
import { asyncHandler } from "../utils/asyncHandler.utils";

const router = Router();

/**
 * @swagger
 * /developer/keys:
 *   post:
 *     summary: Create a new public API key
 *     tags: [Developer]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, scopes]
 *             properties:
 *               name: { type: string }
 *               scopes: { type: array, items: { type: string } }
 *               rate_limit: { type: integer, default: 1000 }
 *               description: { type: string }
 *               expires_at: { type: string, format: date-time }
 *     responses:
 *       201:
 *         description: API key created (plain key shown once)
 */
router.post("/keys", authenticate, asyncHandler(ApiKeyController.create));

/**
 * @swagger
 * /developer/keys:
 *   get:
 *     summary: List all API keys for the authenticated user
 *     tags: [Developer]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of API keys (without plain key values)
 */
router.get("/keys", authenticate, asyncHandler(ApiKeyController.list));

/**
 * @swagger
 * /developer/keys/{id}/revoke:
 *   delete:
 *     summary: Revoke an API key
 *     tags: [Developer]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Key revoked
 *       404:
 *         description: Key not found
 */
router.delete(
  "/keys/:id/revoke",
  authenticate,
  asyncHandler(ApiKeyController.revoke),
);

/**
 * @swagger
 * /developer/scopes:
 *   get:
 *     summary: List all available API scopes
 *     tags: [Developer]
 *     responses:
 *       200:
 *         description: Available scopes
 */
router.get("/scopes", asyncHandler(ApiKeyController.listScopes));

export default router;
