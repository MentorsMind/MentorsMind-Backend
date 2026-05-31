import { Router, Request, Response } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/auth.middleware";
import { requireAdmin } from "../middleware/admin-auth.middleware";
import { asyncHandler } from "../utils/asyncHandler.utils";
import { CDNService } from "../services/cdn.service";
import { ResponseUtil } from "../utils/response.utils";

const router = Router();

const invalidateSchema = z.object({
  paths: z
    .array(z.string().startsWith("/", "Each path must start with /"))
    .min(1, "At least one path is required")
    .max(100, "Maximum 100 paths per request"),
});

/**
 * @swagger
 * /cdn/invalidate:
 *   post:
 *     summary: Invalidate CDN cache for given paths
 *     tags: [CDN]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [paths]
 *             properties:
 *               paths:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["/images/avatar.jpg", "/videos/*"]
 *     responses:
 *       200:
 *         description: Invalidation submitted
 *       400:
 *         description: Validation error or CDN not configured
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — admin only
 */
router.post(
  "/invalidate",
  authenticate,
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = invalidateSchema.safeParse(req.body);
    if (!parsed.success) {
      return ResponseUtil.error(res, parsed.error.issues[0].message, 400);
    }

    if (!CDNService.getConfig()) {
      return ResponseUtil.error(res, "CDN is not configured", 400);
    }

    const result = await CDNService.invalidate(parsed.data.paths);
    return ResponseUtil.success(res, result, "Cache invalidation submitted");
  }),
);

/**
 * @swagger
 * /cdn/asset-url:
 *   get:
 *     summary: Resolve an asset path to its CDN URL
 *     tags: [CDN]
 *     parameters:
 *       - in: query
 *         name: path
 *         required: true
 *         schema:
 *           type: string
 *         example: /images/avatar.jpg
 *     responses:
 *       200:
 *         description: CDN URL for the asset
 *       400:
 *         description: Missing path parameter
 */
router.get(
  "/asset-url",
  asyncHandler(async (req: Request, res: Response) => {
    const assetPath = req.query.path as string | undefined;
    if (!assetPath) {
      return ResponseUtil.error(res, "Query parameter 'path' is required", 400);
    }
    const url = CDNService.getAssetUrl(assetPath);
    return ResponseUtil.success(res, { url }, "Asset URL resolved");
  }),
);

export default router;
