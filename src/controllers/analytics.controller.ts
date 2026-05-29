import { Response } from "express";
import { AuthenticatedRequest } from "../types/api.types";
import { AnalyticsService, AnalyticsViewsUnavailableError } from "../services/analytics.service";
import { ResponseUtil } from "../utils/response.utils";
import { asyncHandler } from "../utils/asyncHandler.utils";

export const AnalyticsController = {
  /**
   * GET /api/v1/admin/analytics/revenue
   * Get revenue analytics
   */
  getRevenue: asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const period = (req.query.period as string) || "30d";
      const format = req.query.format as string;

      if (format === "csv") {
        const csv = await AnalyticsService.exportToCSV("revenue", period);
        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="revenue-${period}.csv"`,
        );
        res.send(csv);
        return;
      }

      const data = await AnalyticsService.getRevenue(period);
      ResponseUtil.success(res, data, "Revenue analytics retrieved");
    } catch (error) {
      if (error instanceof AnalyticsViewsUnavailableError) {
        ResponseUtil.error(res, error.message, 503);
        return;
      }
      throw error;
    }
  }),

  /**
   * GET /api/v1/admin/analytics/users
   * Get user growth analytics
   */
  getUserGrowth: asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const period = (req.query.period as string) || "30d";
      const format = req.query.format as string;

      if (format === "csv") {
        const csv = await AnalyticsService.exportToCSV("users", period);
        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="users-${period}.csv"`,
        );
        res.send(csv);
        return;
      }

      const data = await AnalyticsService.getUserGrowth(period);
      ResponseUtil.success(res, data, "User growth analytics retrieved");
    } catch (error) {
      if (error instanceof AnalyticsViewsUnavailableError) {
        ResponseUtil.error(res, error.message, 503);
        return;
      }
      throw error;
    }
  }),

  /**
   * GET /api/v1/admin/analytics/sessions
   * Get session analytics
   */
  getSessions: asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const period = (req.query.period as string) || "30d";
      const format = req.query.format as string;

      if (format === "csv") {
        const csv = await AnalyticsService.exportToCSV("sessions", period);
        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="sessions-${period}.csv"`,
        );
        res.send(csv);
        return;
      }

      const data = await AnalyticsService.getSessions(period);
      ResponseUtil.success(res, data, "Session analytics retrieved");
    } catch (error) {
      if (error instanceof AnalyticsViewsUnavailableError) {
        ResponseUtil.error(res, error.message, 503);
        return;
      }
      throw error;
    }
  }),

  /**
   * GET /api/v1/admin/analytics/top-mentors
   * Get top mentors
   */
  getTopMentors: asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const format = req.query.format as string;

      if (format === "csv") {
        const csv = await AnalyticsService.exportToCSV("top-mentors");
        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
          "Content-Disposition",
          'attachment; filename="top-mentors.csv"',
        );
        res.send(csv);
        return;
      }

      const data = await AnalyticsService.getTopMentors(limit);
      ResponseUtil.success(res, data, "Top mentors retrieved");
    } catch (error) {
      if (error instanceof AnalyticsViewsUnavailableError) {
        ResponseUtil.error(res, error.message, 503);
        return;
      }
      throw error;
    }
  }),

  /**
   * GET /api/v1/admin/analytics/asset-distribution
   * Get asset distribution
   */
  getAssetDistribution: asyncHandler(async (
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> => {
    try {
      const format = req.query.format as string;

      if (format === "csv") {
        const csv = await AnalyticsService.exportToCSV("asset-distribution");
        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
          "Content-Disposition",
          'attachment; filename="asset-distribution.csv"',
        );
        res.send(csv);
        return;
      }

      const data = await AnalyticsService.getAssetDistribution();
      ResponseUtil.success(res, data, "Asset distribution retrieved");
    } catch (error) {
      if (error instanceof AnalyticsViewsUnavailableError) {
        ResponseUtil.error(res, error.message, 503);
        return;
      }
      throw error;
    }
  }),

  /**
   * POST /api/v1/admin/analytics/refresh
   * Refresh analytics views
   */
  refreshViews: asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    await AnalyticsService.refreshViews();
    ResponseUtil.success(res, null, "Analytics views refreshed successfully");
  }),
};
