import { NextFunction, Request, Response, Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.utils";
import { ResponseUtil } from "../utils/response.utils";
import { ZapierController } from "../controllers/zapier.controller";
import { ZapierService } from "../services/zapier.service";
import { validate } from "../middleware/validation.middleware";
import {
  authenticateApiKey,
  requireApiKeyPermission,
  ApiKeyRequest,
} from "../middleware/api-key.middleware";
import {
  zapierSubscribeSchema,
  zapierUnsubscribeSchema,
  zapierTriggerSampleParamSchema,
  zapierActionSampleParamSchema,
  zapierExecuteActionSchema,
} from "../validators/schemas/integrations.schemas";

interface ZapierRequest extends ApiKeyRequest {
  zapier?: Awaited<ReturnType<typeof ZapierService.authenticateApiKey>>;
}

const router = Router();

/**
 * Middleware to convert API key authentication to Zapier context
 * This maintains backward compatibility while using the new auth system
 */
async function setupZapierContext(
  req: ZapierRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.apiKey) {
    ResponseUtil.unauthorized(res, "Valid integration API key required");
    return;
  }

  // Convert API key context to Zapier context
  req.zapier = {
    apiKeyId: req.apiKey.id,
    ownerUserId: req.apiKey.userId,
  };

  next();
}

// All Zapier routes require API key authentication
router.use("/zapier", authenticateApiKey, setupZapierContext);

// Public routes (require any valid API key)
router.get("/zapier/triggers", asyncHandler(ZapierController.listTriggers));
router.get(
  "/zapier/sample/:trigger",
  validate(zapierTriggerSampleParamSchema),
  asyncHandler(ZapierController.sample),
);
router.get(
  "/zapier/actions/:action/sample",
  validate(zapierActionSampleParamSchema),
  asyncHandler(ZapierController.sampleAction),
);

// Webhook management (requires webhooks:manage scope)
router.post(
  "/zapier/subscribe",
  requireApiKeyPermission("webhooks:manage"),
  validate(zapierSubscribeSchema),
  asyncHandler(ZapierController.subscribe),
);
router.delete(
  "/zapier/unsubscribe",
  requireApiKeyPermission("webhooks:manage"),
  validate(zapierUnsubscribeSchema),
  asyncHandler(ZapierController.unsubscribe),
);

// Action execution (requires appropriate scope based on action)
router.post(
  "/zapier/actions/:action",
  validate(zapierExecuteActionSchema),
  asyncHandler(ZapierController.executeAction),
);

export default router;
