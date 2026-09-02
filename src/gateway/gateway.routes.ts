/**
 * API Gateway management & monitoring routes
 *
 * Mounted (opt-in) under `/api/v1/gateway`. Provides:
 *   GET  /gateway/health            — gateway + per-instance health snapshot
 *   GET  /gateway/stats             — traffic / error / circuit counters
 *   GET  /gateway/services          — full service catalogue (admin)
 *   POST /gateway/services/register — register an upstream instance (admin)
 *   POST /gateway/services/deregister — remove an upstream instance (admin)
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/auth.middleware";
import { requireAdmin } from "../middleware/admin-auth.middleware";
import { asyncHandler } from "../utils/asyncHandler.utils";
import { ResponseUtil } from "../utils/response.utils";
import { getApiGateway } from "./api-gateway";
import gatewayConfig from "./gateway.config";

const router = Router();

const registerSchema = z.object({
  service: z.string().min(1).max(64),
  prefix: z
    .string()
    .regex(/^\/[a-zA-Z0-9\-_/]*$/, "prefix must start with /")
    .optional(),
  url: z.string().url(),
  weight: z.number().int().positive().max(1000).optional(),
  healthCheckPath: z.string().startsWith("/").optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

const deregisterSchema = z.object({
  service: z.string().min(1).max(64),
  url: z.string().url(),
});

/**
 * @swagger
 * /gateway/health:
 *   get:
 *     summary: API gateway health snapshot
 *     tags: [Gateway]
 *     responses:
 *       200: { description: Gateway health and per-instance status }
 */
router.get(
  "/health",
  asyncHandler(async (_req: Request, res: Response) => {
    const stats = getApiGateway().getStats();
    const instances = stats.services.flatMap((s) => s.instances);
    const healthy = instances.filter((i) => i.health === "healthy").length;
    const degraded = stats.services.some(
      (s) => s.circuit === "open" || s.instances.every((i) => i.health === "unhealthy"),
    );

    return ResponseUtil.success(res, {
      enabled: gatewayConfig.enabled,
      status: degraded ? "degraded" : "ok",
      uptimeSeconds: stats.uptimeSeconds,
      services: stats.services.length,
      instances: { total: instances.length, healthy },
    });
  }),
);

/**
 * @swagger
 * /gateway/stats:
 *   get:
 *     summary: API gateway traffic and circuit-breaker statistics
 *     tags: [Gateway]
 *     responses:
 *       200: { description: Counters and per-service state }
 */
router.get(
  "/stats",
  asyncHandler(async (_req: Request, res: Response) => {
    return ResponseUtil.success(res, getApiGateway().getStats());
  }),
);

/**
 * @swagger
 * /gateway/services:
 *   get:
 *     summary: List the gateway service catalogue
 *     tags: [Gateway]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Service catalogue }
 */
router.get(
  "/services",
  authenticate,
  requireAdmin,
  asyncHandler(async (_req: Request, res: Response) => {
    const services = getApiGateway().registry.listServices();
    return ResponseUtil.success(res, { services });
  }),
);

/**
 * @swagger
 * /gateway/services/register:
 *   post:
 *     summary: Register (or refresh) an upstream service instance
 *     tags: [Gateway]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Instance registered }
 *       400: { description: Validation error }
 */
router.post(
  "/services/register",
  authenticate,
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return ResponseUtil.error(res, parsed.error.issues[0].message, 400);
    }
    const service = getApiGateway().registry.registerInstance(parsed.data);
    return ResponseUtil.success(res, { service }, "Instance registered", 200);
  }),
);

/**
 * @swagger
 * /gateway/services/deregister:
 *   post:
 *     summary: Remove an upstream service instance
 *     tags: [Gateway]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Instance removed }
 *       404: { description: Instance not found }
 */
router.post(
  "/services/deregister",
  authenticate,
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = deregisterSchema.safeParse(req.body);
    if (!parsed.success) {
      return ResponseUtil.error(res, parsed.error.issues[0].message, 400);
    }
    const removed = getApiGateway().registry.deregisterInstance(
      parsed.data.service,
      parsed.data.url,
    );
    if (!removed) {
      return ResponseUtil.error(res, "Service instance not found", 404);
    }
    return ResponseUtil.success(res, { removed: true }, "Instance removed");
  }),
);

export default router;
