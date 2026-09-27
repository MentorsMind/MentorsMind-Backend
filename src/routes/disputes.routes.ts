import { Router } from "express";
import { DisputesController } from "../controllers/disputes.controller";
import { validate } from "../middleware/validation.middleware";
import { authenticate, requireRole } from "../middleware/auth.middleware";
import { disputeIdParamSchema } from "../validators/schemas/disputes.schemas";
import {
  openDisputeSchema,
  uploadEvidenceSchema,
  resolveDisputeSchema,
  mediateDisputeSchema,
} from "../validators/disputes.validator";

const router = Router();

// Apply authentication to all dispute routes
router.use(authenticate as any);

// User/Admin routes
router.get("/templates/resolution", DisputesController.getResolutionTemplates);
router.get("/", DisputesController.listDisputes);
router.post("/", validate(openDisputeSchema), DisputesController.openDispute);
router.get("/:id", validate(disputeIdParamSchema), DisputesController.getDispute);
router.post(
  "/:id/evidence",
  validate(uploadEvidenceSchema),
  DisputesController.uploadEvidence,
);

// Admin-only routes
router.post(
  "/:id/resolve",
  requireRole(["admin"]) as any,
  validate(resolveDisputeSchema),
  DisputesController.resolveDispute,
);
router.post(
  "/:id/mediate",
  requireRole(["admin"]) as any,
  validate(mediateDisputeSchema),
  DisputesController.mediateDispute,
);

export default router;
