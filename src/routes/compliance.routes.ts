import { Router } from "express";
import { ComplianceController } from "../controllers/compliance.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/rbac.middleware";
import { asyncHandler } from "../utils/asyncHandler.utils";

const router = Router();

router.post("/dsar", authenticate, asyncHandler(ComplianceController.createDSAR));
router.get("/dsar", authenticate, asyncHandler(ComplianceController.getDSARs));
router.get("/dsar/:id", authenticate, asyncHandler(ComplianceController.getDSARById));
router.post(
  "/dsar/:id/complete",
  authenticate,
  requireRole("admin"),
  asyncHandler(ComplianceController.completeDSAR),
);

router.post(
  "/retention",
  authenticate,
  requireRole("admin"),
  asyncHandler(ComplianceController.createRetentionPolicy),
);
router.get(
  "/retention",
  authenticate,
  requireRole("admin"),
  asyncHandler(ComplianceController.getRetentionPolicies),
);
router.post(
  "/retention/enforce",
  authenticate,
  requireRole("admin"),
  asyncHandler(ComplianceController.enforceRetentionPolicies),
);

router.post(
  "/lineage",
  authenticate,
  asyncHandler(ComplianceController.recordLineageEvent),
);
router.get(
  "/lineage",
  authenticate,
  requireRole("admin"),
  asyncHandler(ComplianceController.getLineageEvents),
);

router.get(
  "/report",
  authenticate,
  requireRole("admin"),
  asyncHandler(ComplianceController.generateComplianceReport),
);

export default router;
