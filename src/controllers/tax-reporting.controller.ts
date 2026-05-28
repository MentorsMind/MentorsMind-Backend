import { Request, Response } from "express";
import { z } from "zod";
import { TaxReportingService } from "../services/tax-reporting.service";
import { ResponseUtil } from "../utils/response.utils";
import { asyncHandler } from "../utils/asyncHandler.utils";

const currentYear = new Date().getFullYear();

const taxInfoSchema = z.object({
  taxIdType: z.enum(["SSN", "EIN", "ITIN", "FOREIGN"]).optional(),
  taxIdLast4: z
    .string()
    .length(4)
    .regex(/^\d{4}$/)
    .optional(),
  isInternational: z.boolean().optional(),
  countryCode: z.string().length(2).optional(),
});

export const TaxReportingController = {
  /**
   * GET /api/v1/tax/reports
   * List all tax reports for the authenticated mentor
   */
  listReports: asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const userId = (req as any).user?.id;
      if (!userId) {
        ResponseUtil.error(res, "Unauthorized", 401);
        return;
      }

      const reports = await TaxReportingService.listReports(userId);
      ResponseUtil.success(res, { reports });
    },
  ),

  /**
   * GET /api/v1/tax/reports/:year
   * Get tax report for a specific year
   */
  getReport: asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const userId = (req as any).user?.id;
      if (!userId) {
        ResponseUtil.error(res, "Unauthorized", 401);
        return;
      }

      const taxYear = parseInt(req.params.year, 10);
      if (isNaN(taxYear) || taxYear < 2020 || taxYear > currentYear) {
        ResponseUtil.error(res, "Invalid tax year", 400);
        return;
      }

      const report = await TaxReportingService.getReport(userId, taxYear);
      if (!report) {
        ResponseUtil.error(res, "Tax report not found", 404);
        return;
      }

      const documents = await TaxReportingService.getDocuments(report.id);
      ResponseUtil.success(res, { ...report, taxDocuments: documents });
    },
  ),

  /**
   * POST /api/v1/tax/reports/:year/generate
   * Generate/refresh a tax report for a year
   */
  generateReport: asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const userId = (req as any).user?.id;
      if (!userId) {
        ResponseUtil.error(res, "Unauthorized", 401);
        return;
      }

      const taxYear = parseInt(req.params.year, 10);
      if (isNaN(taxYear) || taxYear < 2020 || taxYear > currentYear) {
        ResponseUtil.error(res, "Invalid tax year", 400);
        return;
      }

      const report = await TaxReportingService.generateReport(userId, taxYear);
      if (!report) {
        ResponseUtil.error(res, "Failed to generate tax report", 500);
        return;
      }

      const documents = await TaxReportingService.getDocuments(report.id);
      ResponseUtil.success(
        res,
        { ...report, taxDocuments: documents },
        "Tax report generated",
        201,
      );
    },
  ),

  /**
   * GET /api/v1/tax/info
   * Get mentor tax information
   */
  getTaxInfo: asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const userId = (req as any).user?.id;
      if (!userId) {
        ResponseUtil.error(res, "Unauthorized", 401);
        return;
      }

      const info = await TaxReportingService.getTaxInfo(userId);
      ResponseUtil.success(res, info ?? {});
    },
  ),

  /**
   * PUT /api/v1/tax/info
   * Save mentor tax information (W-9 data)
   */
  saveTaxInfo: asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const userId = (req as any).user?.id;
      if (!userId) {
        ResponseUtil.error(res, "Unauthorized", 401);
        return;
      }

      const validation = taxInfoSchema.safeParse(req.body);
      if (!validation.success) {
        ResponseUtil.error(res, validation.error.issues[0].message, 400);
        return;
      }

      const info = await TaxReportingService.saveTaxInfo(
        userId,
        validation.data,
      );
      if (!info) {
        ResponseUtil.error(res, "Failed to save tax information", 500);
        return;
      }

      ResponseUtil.success(res, info, "Tax information saved");
    },
  ),

  /**
   * POST /api/v1/tax/w9
   * Submit W-9 form acknowledgement
   */
  submitW9: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user?.id;
    if (!userId) {
      ResponseUtil.error(res, "Unauthorized", 401);
      return;
    }

    const success = await TaxReportingService.submitW9(userId);
    if (!success) {
      ResponseUtil.error(
        res,
        "Failed to record W-9 submission. Ensure tax info is saved first.",
        400,
      );
      return;
    }

    ResponseUtil.success(res, { w9OnFile: true }, "W-9 submitted successfully");
  }),
};
