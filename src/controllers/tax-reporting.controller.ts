import { Response } from "express";
import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import { z } from "zod";
import { TaxReportingService } from "../services/tax-reporting.service";
import { ResponseUtil } from "../utils/response.utils";
import { asyncHandler } from "../utils/asyncHandler.utils";

const currentYear = new Date().getFullYear();

const taxInfoSchema = z.object({
  taxIdType: z.enum(["SSN", "EIN", "ITIN", "FOREIGN"]).optional(),
  taxIdLast4: z.string().length(4).regex(/^\d{4}$/).optional(),
  isInternational: z.boolean().optional(),
  countryCode: z.string().length(2).optional(),
});

function requireUser(req: AuthenticatedRequest, res: Response): string | null {
  const userId = req.user?.id;
  if (!userId) ResponseUtil.error(res, "Unauthorized", 401);
  return userId ?? null;
}

export const TaxReportingController = {
  listReports: asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const reports = await TaxReportingService.listReports(userId);
    ResponseUtil.success(res, { reports });
  }),

  getReport: asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const taxYear = parseInt(req.params.year as string, 10);
    if (isNaN(taxYear) || taxYear < 2020 || taxYear > currentYear) {
      ResponseUtil.error(res, "Invalid tax year", 400);
      return;
    }
    const report = await TaxReportingService.getReport(userId, taxYear);
    if (!report) { ResponseUtil.error(res, "Tax report not found", 404); return; }
    const documents = await TaxReportingService.getDocuments(report.id);
    ResponseUtil.success(res, { ...report, taxDocuments: documents });
  }),

  generateReport: asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const taxYear = parseInt(req.params.year as string, 10);
    if (isNaN(taxYear) || taxYear < 2020 || taxYear > currentYear) {
      ResponseUtil.error(res, "Invalid tax year", 400);
      return;
    }
    const report = await TaxReportingService.generateReport(userId, taxYear);
    if (!report) { ResponseUtil.error(res, "Failed to generate tax report", 500); return; }
    const documents = await TaxReportingService.getDocuments(report.id);
    ResponseUtil.success(res, { ...report, taxDocuments: documents }, "Tax report generated", 201);
  }),

  getTaxInfo: asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const info = await TaxReportingService.getTaxInfo(userId);
    ResponseUtil.success(res, info ?? {});
  }),

  saveTaxInfo: asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const validation = taxInfoSchema.safeParse(req.body);
    if (!validation.success) { ResponseUtil.error(res, validation.error.issues[0].message, 400); return; }
    const info = await TaxReportingService.saveTaxInfo(userId, validation.data);
    if (!info) { ResponseUtil.error(res, "Failed to save tax information", 500); return; }
    ResponseUtil.success(res, info, "Tax information saved");
  }),

  submitW9: asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const success = await TaxReportingService.submitW9(userId);
    if (!success) {
      ResponseUtil.error(res, "Failed to record W-9 submission. Ensure tax info is saved first.", 400);
      return;
    }
    ResponseUtil.success(res, { w9OnFile: true }, "W-9 submitted successfully");
  }),

  getJurisdiction: asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const jurisdiction = await TaxReportingService.getJurisdiction(userId);
    ResponseUtil.success(res, jurisdiction);
  }),

  exportReport: asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const taxYear = parseInt(req.params.year as string, 10);
    if (isNaN(taxYear) || taxYear < 2020 || taxYear > currentYear) {
      ResponseUtil.error(res, "Invalid tax year", 400);
      return;
    }
    const exportData = await TaxReportingService.generateExport(userId, taxYear);
    if (!exportData) { ResponseUtil.error(res, "Tax report not found", 404); return; }
    res.setHeader("Content-Type", exportData.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${exportData.fileName}"`);
    res.send(exportData.data);
  }),
};
