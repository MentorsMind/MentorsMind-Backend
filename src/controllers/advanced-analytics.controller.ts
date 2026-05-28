import { Response } from "express";
import { AuthenticatedRequest } from "../types/api.types";
import { AdvancedAnalyticsService } from "../services/advanced-analytics.service";
import { ResponseUtil } from "../utils/response.utils";
import { asyncHandler } from "../utils/asyncHandler.utils";
import { logger } from "../utils/logger";

export const AdvancedAnalyticsController = {
  /**
   * GET /api/v1/analytics/dashboard
   * Get comprehensive dashboard data
   */
  getDashboard: asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      const period = (req.query.period as string) || "30d";
      const realTime = req.query.realTime === 'true';

      if (!userId) {
        ResponseUtil.error(res, "User not authenticated", 401);
        return;
      }

      let data;
      if (realTime) {
        // Get real-time data (bypasses cache)
        const metrics = await AdvancedAnalyticsService.getRealTimeMetrics(userId, period);
        data = {
          userId,
          metrics,
          predictions: { nextMonthRevenue: 0, demandForecast: [] },
          insights: [],
          lastUpdated: new Date().toISOString()
        };
      } else {
        data = await AdvancedAnalyticsService.getDashboard(userId, period);
      }

      ResponseUtil.success(res, data, "Dashboard data retrieved successfully");
    } catch (error) {
      logger.error('Failed to get dashboard data', { error, userId: req.user?.id });
      ResponseUtil.error(res, "Failed to retrieve dashboard data", 500);
    }
  }),

  /**
   * GET /api/v1/analytics/revenue
   * Get revenue analytics with enhanced filtering
   */
  getRevenue: asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const period = (req.query.period as string) || "30d";
      const currency = req.query.currency as string;
      const format = req.query.format as string;

      // Get revenue data
      const days = AdvancedAnalyticsService.parsePeriod ? 
        AdvancedAnalyticsService.parsePeriod(period) : 30;
      
      const revenueMetrics = await AdvancedAnalyticsService.getRevenueMetrics(days);

      // Filter by currency if specified
      let data = revenueMetrics;
      if (currency) {
        data = {
          ...revenueMetrics,
          currencyBreakdown: revenueMetrics.currencyBreakdown.filter(
            cb => cb.currency === currency
          )
        };
      }

      // Handle CSV export
      if (format === "csv") {
        const csv = await this.exportRevenueToCSV(data, period);
        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="revenue-${period}.csv"`
        );
        res.send(csv);
        return;
      }

      ResponseUtil.success(res, data, "Revenue analytics retrieved successfully");
    } catch (error) {
      logger.error('Failed to get revenue analytics', { error });
      ResponseUtil.error(res, "Failed to retrieve revenue analytics", 500);
    }
  }),

  /**
   * GET /api/v1/analytics/sessions
   * Get session analytics with status filtering
   */
  getSessions: asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const period = (req.query.period as string) || "30d";
      const status = req.query.status as string;
      const format = req.query.format as string;

      const days = AdvancedAnalyticsService.parsePeriod ? 
        AdvancedAnalyticsService.parsePeriod(period) : 30;
      
      const sessionMetrics = await AdvancedAnalyticsService.getSessionMetrics(days);

      // Handle CSV export
      if (format === "csv") {
        const csv = await this.exportSessionsToCSV(sessionMetrics, period);
        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="sessions-${period}.csv"`
        );
        res.send(csv);
        return;
      }

      ResponseUtil.success(res, sessionMetrics, "Session analytics retrieved successfully");
    } catch (error) {
      logger.error('Failed to get session analytics', { error });
      ResponseUtil.error(res, "Failed to retrieve session analytics", 500);
    }
  }),

  /**
   * GET /api/v1/analytics/users
   * Get user analytics with role filtering
   */
  getUsers: asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const period = (req.query.period as string) || "30d";
      const role = req.query.role as string;
      const format = req.query.format as string;

      const days = AdvancedAnalyticsService.parsePeriod ? 
        AdvancedAnalyticsService.parsePeriod(period) : 30;
      
      const studentMetrics = await AdvancedAnalyticsService.getStudentMetrics(days);

      // Handle CSV export
      if (format === "csv") {
        const csv = await this.exportUsersToCSV(studentMetrics, period);
        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="users-${period}.csv"`
        );
        res.send(csv);
        return;
      }

      ResponseUtil.success(res, studentMetrics, "User analytics retrieved successfully");
    } catch (error) {
      logger.error('Failed to get user analytics', { error });
      ResponseUtil.error(res, "Failed to retrieve user analytics", 500);
    }
  }),

  /**
   * GET /api/v1/analytics/growth
   * Get growth metrics
   */
  getGrowth: asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const period = (req.query.period as string) || "30d";

      const days = AdvancedAnalyticsService.parsePeriod ? 
        AdvancedAnalyticsService.parsePeriod(period) : 30;
      
      const growthMetrics = await AdvancedAnalyticsService.getGrowthMetrics(days);

      ResponseUtil.success(res, growthMetrics, "Growth analytics retrieved successfully");
    } catch (error) {
      logger.error('Failed to get growth analytics', { error });
      ResponseUtil.error(res, "Failed to retrieve growth analytics", 500);
    }
  }),
  /**
   * GET /api/v1/analytics/metrics/:type
   * Get metrics by date range
   */
  getMetricsByDateRange: asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const metricType = req.params.type;
      const startDate = new Date(req.query.startDate as string);
      const endDate = new Date(req.query.endDate as string);
      const filters = req.query.filters ? JSON.parse(req.query.filters as string) : {};

      // Validate date range
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        ResponseUtil.error(res, "Invalid date range provided", 400);
        return;
      }

      // Validate date range is not too large (max 2 years)
      const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      if (daysDiff > 730) {
        ResponseUtil.error(res, "Date range cannot exceed 2 years", 400);
        return;
      }

      const data = await AdvancedAnalyticsService.getMetricsByDateRange(
        metricType,
        startDate,
        endDate,
        filters
      );

      ResponseUtil.success(res, data, `${metricType} metrics retrieved successfully`);
    } catch (error) {
      logger.error('Failed to get metrics by date range', { error, metricType: req.params.type });
      ResponseUtil.error(res, "Failed to retrieve metrics", 500);
    }
  }),

  /**
   * POST /api/v1/analytics/refresh
   * Refresh analytics data
   */
  refreshAnalytics: asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      // Check if user has admin permissions
      if (req.user?.role !== 'admin') {
        ResponseUtil.error(res, "Insufficient permissions", 403);
        return;
      }

      await AdvancedAnalyticsService.refreshAnalytics();
      ResponseUtil.success(res, null, "Analytics data refreshed successfully");
    } catch (error) {
      logger.error('Failed to refresh analytics', { error });
      ResponseUtil.error(res, "Failed to refresh analytics data", 500);
    }
  }),

  /**
   * GET /api/v1/analytics/health
   * Get analytics system health
   */
  getHealth: asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { CacheService } = await import('../services/cache.service');
      
      // Get health metrics
      const health = await CacheService.get('analytics:health') || {
        status: 'unknown',
        lastCheck: new Date().toISOString()
      };

      // Add current timestamp
      health.currentTime = new Date().toISOString();

      ResponseUtil.success(res, health, "Analytics health retrieved successfully");
    } catch (error) {
      logger.error('Failed to get analytics health', { error });
      ResponseUtil.error(res, "Failed to retrieve analytics health", 500);
    }
  }),

  // Helper methods for CSV export
  async exportRevenueToCSV(data: any, period: string): Promise<string> {
    const headers = [
      'Total Amount',
      'Platform Fee',
      'Transaction Count',
      'Average Transaction Value',
      'Growth Rate (%)',
      'Period'
    ];

    const rows = [
      headers.join(','),
      [
        data.totalAmount,
        data.platformFee,
        data.transactionCount,
        data.avgTransactionValue,
        data.growthRate,
        period
      ].join(',')
    ];

    // Add currency breakdown
    if (data.currencyBreakdown && data.currencyBreakdown.length > 0) {
      rows.push(''); // Empty line
      rows.push('Currency Breakdown');
      rows.push('Currency,Amount,Transaction Count,Percentage');
      
      for (const currency of data.currencyBreakdown) {
        rows.push([
          currency.currency,
          currency.amount,
          currency.transactionCount,
          currency.percentage
        ].join(','));
      }
    }

    return rows.join('\n');
  },

  async exportSessionsToCSV(data: any, period: string): Promise<string> {
    const headers = [
      'Total Sessions',
      'Completed Sessions',
      'Completion Rate (%)',
      'Average Duration (minutes)',
      'Cancelled Sessions',
      'Upcoming Sessions',
      'Period'
    ];

    const rows = [
      headers.join(','),
      [
        data.totalSessions,
        data.completedSessions,
        data.completionRate,
        data.avgDuration,
        data.cancelledSessions,
        data.upcomingSessions,
        period
      ].join(',')
    ];

    return rows.join('\n');
  },

  async exportUsersToCSV(data: any, period: string): Promise<string> {
    const headers = [
      'Total Students',
      'Active Students',
      'New Students',
      'Retention Rate (%)',
      'Average Sessions per Student',
      'Period'
    ];

    const rows = [
      headers.join(','),
      [
        data.totalStudents,
        data.activeStudents,
        data.newStudents,
        data.retentionRate,
        data.avgSessionsPerStudent,
        period
      ].join(',')
    ];

    return rows.join('\n');
  }
};