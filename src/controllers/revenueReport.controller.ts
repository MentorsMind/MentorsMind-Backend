import { Response } from "express";
import { AuthenticatedRequest } from "../types/api.types";
import { ResponseUtil } from "../utils/response.utils";
import { RevenueReportService } from "../services/revenueReport.service";

const VALID_EXPORT_TYPES = new Set(["revenue"]);
const VALID_EXPORT_FORMATS = new Set(["csv"]);

export const RevenueReportController = {
  /** GET /api/v1/admin/reports/revenue */
  async getRevenueSummary(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    try {
      const period = (req.query.period as string) || "30d";
      const data = await RevenueReportService.getRevenueSummary(period);

      ResponseUtil.success(res, data, "Revenue summary retrieved successfully");
    } catch (error) {
      ResponseUtil.error(res, (error as Error).message, 400);
    }
  },

  /** GET /api/v1/admin/reports/revenue/daily */
  async getDailyRevenue(req: AuthenticatedRequest, res: Response): Promise<void> {
    const from = req.query.from as string;
    const to = req.query.to as string;

    if (!from || !to) {
      ResponseUtil.error(res, "Both from and to query parameters are required", 400);
      return;
    }

    try {
      const data = await RevenueReportService.getDailyRevenue(from, to);
      ResponseUtil.success(res, data, "Daily revenue report retrieved successfully");
    } catch (error) {
      ResponseUtil.error(res, (error as Error).message, 400);
    }
  },

  /** GET /api/v1/admin/reports/transactions */
  async getTransactions(req: AuthenticatedRequest, res: Response): Promise<void> {
    const status = req.query.status as string | undefined;
    const from = req.query.from as string;
    const to = req.query.to as string;

    if (!from || !to) {
      ResponseUtil.error(res, "Both from and to query parameters are required", 400);
      return;
    }

    try {
      const data = await RevenueReportService.getTransactions({
        status,
        from,
        to,
      });

      ResponseUtil.success(
        res,
        data,
        "Revenue transactions report retrieved successfully",
      );
    } catch (error) {
      ResponseUtil.error(res, (error as Error).message, 400);
    }
  },

  /** GET /api/v1/admin/reports/export */
  async exportReport(req: AuthenticatedRequest, res: Response): Promise<void> {
    const type = (req.query.type as string) || "revenue";
    const format = (req.query.format as string) || "csv";

    if (!VALID_EXPORT_TYPES.has(type)) {
      ResponseUtil.error(res, "Unsupported export type", 400);
      return;
    }

    if (!VALID_EXPORT_FORMATS.has(format)) {
      ResponseUtil.error(res, "Unsupported export format", 400);
      return;
    }

    try {
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;
      const status = req.query.status as string | undefined;
      const csv = await RevenueReportService.exportRevenueCSV({
        from,
        to,
        status,
      });

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${type}-report-${new Date().toISOString().slice(0, 10)}.csv"`,
      );
      res.send(csv);
    } catch (error) {
      ResponseUtil.error(res, (error as Error).message, 400);
    }
  },
};
