import { Router } from "express";
import { TaxReportingController } from "../controllers/tax-reporting.controller";
import { authenticate } from "../middleware/auth.middleware";
import { validate } from "../middleware/validation.middleware";
import { taxYearParamSchema } from "../validators/schemas/tax.schemas";

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Tax
 *   description: Tax reporting and 1099 generation for mentors
 */

/** GET /api/v1/tax/reports */
router.get("/reports", authenticate, TaxReportingController.listReports);

/** GET /api/v1/tax/reports/:year */
router.get(
  "/reports/:year",
  authenticate,
  validate(taxYearParamSchema),
  TaxReportingController.getReport,
);

/** GET /api/v1/tax/reports/:year/export — jurisdiction export (CSV/VAT/XML) */
router.get(
  "/reports/:year/export",
  authenticate,
  validate(taxYearParamSchema),
  TaxReportingController.exportReport,
);

/** POST /api/v1/tax/reports/:year/generate */
router.post(
  "/reports/:year/generate",
  authenticate,
  validate(taxYearParamSchema),
  TaxReportingController.generateReport,
);

/** GET /api/v1/tax/info */
router.get("/info", authenticate, TaxReportingController.getTaxInfo);

/** GET /api/v1/tax/jurisdiction */
router.get("/jurisdiction", authenticate, TaxReportingController.getJurisdiction);

/** PUT /api/v1/tax/info */
router.put("/info", authenticate, TaxReportingController.saveTaxInfo);

/** POST /api/v1/tax/w9 */
router.post("/w9", authenticate, TaxReportingController.submitW9);

export default router;
