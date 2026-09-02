import { Router } from "express";
import { ComplianceController } from "../controllers/compliance.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/rbac.middleware";
import { asyncHandler } from "../utils/asyncHandler.utils";
import { validate } from "../middleware/validation.middleware";
import {
  createDSARSchema,
  dsarIdParamSchema,
  completeDSARSchema,
  createRetentionPolicySchema,
  recordLineageEventSchema,
  listLineageEventsSchema,
  complianceReportFiltersSchema,
} from "../validators/schemas/compliance.schemas";

const router = Router();

router.post(
  "/dsar",
  authenticate,
  validate(createDSARSchema),
  asyncHandler(ComplianceController.createDSAR),
);
router.get("/dsar", authenticate, asyncHandler(ComplianceController.getDSARs));
router.get(
  "/dsar/:id",
  authenticate,
  validate(dsarIdParamSchema),
  asyncHandler(ComplianceController.getDSARById),
);
router.post(
  "/dsar/:id/complete",
  authenticate,
  requireRole("admin"),
  validate(completeDSARSchema),
  asyncHandler(ComplianceController.completeDSAR),
);

router.post(
  "/retention",
  authenticate,
  requireRole("admin"),
  validate(createRetentionPolicySchema),
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
  "/retention/preview",
  authenticate,
  requireRole("admin"),
  asyncHandler(ComplianceController.previewRetentionPolicies),
);

router.post(
  "/lineage",
  authenticate,
  validate(recordLineageEventSchema),
  asyncHandler(ComplianceController.recordLineageEvent),
);
router.get(
  "/lineage",
  authenticate,
  requireRole("admin"),
  validate(listLineageEventsSchema),
  asyncHandler(ComplianceController.getLineageEvents),
);

router.get(
  "/report",
  authenticate,
  requireRole("admin"),
  validate(complianceReportFiltersSchema),
  asyncHandler(ComplianceController.generateComplianceReport),
);

// ── SAR (Suspicious Activity Report) endpoints ───────────────────────────────

router.post(
  "/sar",
  authenticate,
  requireRole("admin"),
  asyncHandler(ComplianceController.fileSAR),
);

router.get(
  "/sar",
  authenticate,
  requireRole("admin"),
  asyncHandler(ComplianceController.listSARQueue),
);

router.get(
  "/sar/:id",
  authenticate,
  requireRole("admin"),
  asyncHandler(ComplianceController.getSAR),
);

router.patch(
  "/sar/:id",
  authenticate,
  requireRole("admin"),
  asyncHandler(ComplianceController.updateSARStatus),
);

router.get(
  "/sar/:id/export",
  authenticate,
  requireRole("admin"),
  asyncHandler(ComplianceController.exportSAR),
);

export default router;
