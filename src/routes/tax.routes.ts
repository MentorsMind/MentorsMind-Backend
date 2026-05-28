import { Router } from "express";
import { TaxReportingController } from "../controllers/tax-reporting.controller";
import { authenticate } from "../middleware/auth.middleware";

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
router.get("/reports/:year", authenticate, TaxReportingController.getReport);

/** POST /api/v1/tax/reports/:year/generate */
router.post(
  "/reports/:year/generate",
  authenticate,
  TaxReportingController.generateReport,
);

/** GET /api/v1/tax/info */
router.get("/info", authenticate, TaxReportingController.getTaxInfo);

/** PUT /api/v1/tax/info */
router.put("/info", authenticate, TaxReportingController.saveTaxInfo);

/** POST /api/v1/tax/w9 */
router.post("/w9", authenticate, TaxReportingController.submitW9);

export default router;
