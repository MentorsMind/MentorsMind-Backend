/**
 * API Key Management Routes
 *
 * POST   /api/v1/api-keys              — Create a new API key
 * GET    /api/v1/api-keys              — List all API keys for user
 * GET    /api/v1/api-keys/scopes       — List available scopes/permissions
 * DELETE /api/v1/api-keys/:id          — Revoke an API key
 * POST   /api/v1/api-keys/:id/rotate   — Rotate an API key
 * GET    /api/v1/api-keys/:id/usage    — Get usage statistics for an API key
 */

import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { validate } from "../middleware/validation.middleware";
import { ApiKeyController } from "../controllers/api-key.controller";
import { asyncHandler } from "../utils/asyncHandler.utils";
import {
  createApiKeySchema,
  apiKeyIdParamSchema,
} from "../validators/schemas/api-keys.schemas";

const router = Router();

// All routes require JWT authentication
router.use(authenticate);

// Get available scopes (must be before /:id routes)
router.get("/scopes", asyncHandler(ApiKeyController.listScopes));

// CRUD operations
router.post(
  "/",
  validate(createApiKeySchema),
  asyncHandler(ApiKeyController.create)
);

router.get("/", asyncHandler(ApiKeyController.list));

router.delete(
  "/:id",
  validate(apiKeyIdParamSchema),
  asyncHandler(ApiKeyController.revoke)
);

// Key rotation
router.post(
  "/:id/rotate",
  validate(apiKeyIdParamSchema),
  asyncHandler(ApiKeyController.rotate)
);

// Usage statistics
router.get(
  "/:id/usage",
  validate(apiKeyIdParamSchema),
  asyncHandler(ApiKeyController.usage)
);

export default router;
