import { Router } from "express";
import { DeepLinkController } from "../controllers/deepLink.controller";
import { asyncHandler } from "../utils/asyncHandler.utils";

const router = Router();

/**
 * @swagger
 * /dl/{type}/{id}:
 *   get:
 *     summary: Handle deep link redirection with web fallback
 *     tags: [DeepLink]
 *     parameters:
 *       - name: type
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           enum: [session, payment, message]
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Redirection HTML page
 */
router.get("/:type/:id", asyncHandler(DeepLinkController.handleRedirection));

export default router;
