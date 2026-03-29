import { Router } from "express";
import { ConsentController } from "../controllers/consent.controller";
import { authenticate } from "../middleware/auth.middleware";
import { asyncHandler } from "../utils/asyncHandler.utils";

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Consent
 *   description: Cookie consent tracking and management
 */

/**
 * @swagger
 * /api/v1/consent:
 *   post:
 *     summary: Record user's cookie consent choices
 *     tags: [Consent]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - analytics_consent
 *               - marketing_consent
 *               - functional_consent
 *             properties:
 *               analytics_consent:
 *                 type: boolean
 *               marketing_consent:
 *                 type: boolean
 *               functional_consent:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Consent record created successfully
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 */
router.post("/", authenticate, asyncHandler(ConsentController.recordConsent));

/**
 * @swagger
 * /api/v1/consent:
 *   get:
 *     summary: Retrieve current consent record for authenticated user
 *     tags: [Consent]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current consent choices retrieved
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: No consent record found
 */
router.get("/", authenticate, asyncHandler(ConsentController.getConsent));

/**
 * @swagger
 * /api/v1/consent:
 *   put:
 *     summary: Update consent preferences (append-only)
 *     tags: [Consent]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - analytics_consent
 *               - marketing_consent
 *               - functional_consent
 *             properties:
 *               analytics_consent:
 *                 type: boolean
 *               marketing_consent:
 *                 type: boolean
 *               functional_consent:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Consent record created successfully
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 */
router.put("/", authenticate, asyncHandler(ConsentController.updateConsent));

export default router;
