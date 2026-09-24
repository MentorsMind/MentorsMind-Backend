import { Request, Response, NextFunction } from "express";
import { LearningAnalyticsService } from "../services/learning-analytics.service";
import { AdvancedAnalyticsService } from "../services/advanced-analytics.service";
import { AIRecommendationsService } from "../services/ai-recommendations.service";
import { logger } from "../utils/logger.utils";
import { createError } from "../middleware/errorHandler";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import { ErrorCode } from "../errors/error-codes";

export const AnalyticsController = {
  /**
   * Get comprehensive analytics for a learning path
   * GET /api/v1/analytics/paths/:pathId
   */
  async getPathAnalytics(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { pathId } = req.params as Record<string, string>;
      const timeframe = (req.query.timeframe as string) || 'all';

      if (!['week', 'month', 'quarter', 'year', 'all'].includes(timeframe as string)) {
        throw createError(ErrorCode.BAD_REQUEST, 400);
      }

      const analytics = await LearningAnalyticsService.getPathAnalytics(
        pathId,
        timeframe as 'week' | 'month' | 'quarter' | 'year' | 'all'
      );

      res.status(200).json({
        success: true,
        data: analytics
      });
    } catch (error) {
      logger.error("Failed to get path analytics", {
        pathId: req.params.pathId,
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  },

  /**
   * Get student learning profile
   * GET /api/v1/analytics/students/:studentId/profile
   */
  async getStudentProfile(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { studentId } = req.params as Record<string, string>;
      const pathId = req.query.pathId as string | undefined;

      // Verify access: students can only view their own profile, mentors can view their students
      const requestingUserId = req.user?.id;
      const requestingUserRole = req.user?.role;

      if (requestingUserRole !== 'admin' && requestingUserRole !== 'mentor' && requestingUserId !== studentId) {
        throw createError(ErrorCode.AUTHZ_FORBIDDEN, 403);
      }

      const profile = await LearningAnalyticsService.getStudentLearningProfile(
        studentId,
        pathId as string | undefined
      );

      res.status(200).json({
        success: true,
        data: profile
      });
    } catch (error) {
      logger.error("Failed to get student profile", {
        studentId: req.params.studentId,
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  },

  /**
   * Get predictive insights for a student
   * GET /api/v1/analytics/students/:studentId/paths/:pathId/insights
   */
  async getPredictiveInsights(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { studentId, pathId } = req.params as Record<string, string>;

      // Verify access
      const requestingUserId = req.user?.id;
      const requestingUserRole = req.user?.role;

      if (requestingUserRole !== 'admin' && requestingUserRole !== 'mentor' && requestingUserId !== studentId) {
        throw createError(ErrorCode.AUTHZ_FORBIDDEN, 403);
      }

      const insights = await LearningAnalyticsService.getPredictiveInsights(studentId, pathId);

      res.status(200).json({
        success: true,
        data: insights
      });
    } catch (error) {
      logger.error("Failed to get predictive insights", {
        studentId: req.params.studentId,
        pathId: req.params.pathId,
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  },

  /**
   * Get comparison analytics (student vs peers)
   * GET /api/v1/analytics/students/:studentId/paths/:pathId/comparison
   */
  async getComparisonAnalytics(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { studentId, pathId } = req.params as Record<string, string>;

      // Verify access
      const requestingUserId = req.user?.id;
      const requestingUserRole = req.user?.role;

      if (requestingUserRole !== 'admin' && requestingUserRole !== 'mentor' && requestingUserId !== studentId) {
        throw createError(ErrorCode.AUTHZ_FORBIDDEN, 403);
      }

      const comparison = await LearningAnalyticsService.getComparisonAnalytics(studentId, pathId);

      res.status(200).json({
        success: true,
        data: comparison
      });
    } catch (error) {
      logger.error("Failed to get comparison analytics", {
        studentId: req.params.studentId,
        pathId: req.params.pathId,
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  },

  /**
   * Get mentor dashboard analytics
   * GET /api/v1/analytics/mentors/:mentorId/dashboard
   */
  async getMentorDashboard(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { mentorId } = req.params as Record<string, string>;

      // Verify access: only the mentor themselves or admins can view
      const requestingUserId = req.user?.id;
      const requestingUserRole = req.user?.role;

      if (requestingUserRole !== 'admin' && requestingUserId !== mentorId) {
        throw createError(ErrorCode.AUTHZ_FORBIDDEN, 403);
      }

      const dashboard = await LearningAnalyticsService.getMentorDashboardAnalytics(mentorId);

      res.status(200).json({
        success: true,
        data: dashboard
      });
    } catch (error) {
      logger.error("Failed to get mentor dashboard", {
        mentorId: req.params.mentorId,
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  },

  /**
   * Get milestone analytics for a learning path
   * GET /api/v1/analytics/paths/:pathId/milestones
   */
  async getMilestoneAnalytics(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { pathId } = req.params as Record<string, string>;
      const timeframe = (req.query.timeframe as string) || 'all';

      if (!['week', 'month', 'quarter', 'year', 'all'].includes(timeframe as string)) {
        throw createError(ErrorCode.BAD_REQUEST, 400);
      }

      const timeFilter = LearningAnalyticsService['getTimeFilter'](timeframe as string);
      const milestoneAnalytics = await LearningAnalyticsService.getMilestoneAnalytics(pathId, timeFilter);

      res.status(200).json({
        success: true,
        data: milestoneAnalytics
      });
    } catch (error) {
      logger.error("Failed to get milestone analytics", {
        pathId: req.params.pathId,
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  },

  /**
   * Get trend data for a learning path
   * GET /api/v1/analytics/paths/:pathId/trends
   */
  async getTrendData(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { pathId } = req.params as Record<string, string>;
      const timeframe = (req.query.timeframe as string) || 'month';

      if (!['week', 'month', 'quarter', 'year', 'all'].includes(timeframe as string)) {
        throw createError(ErrorCode.BAD_REQUEST, 400);
      }

      const trendData = await LearningAnalyticsService.getTrendData(
        pathId,
        timeframe as 'week' | 'month' | 'quarter' | 'year' | 'all'
      );

      res.status(200).json({
        success: true,
        data: trendData
      });
    } catch (error) {
      logger.error("Failed to get trend data", {
        pathId: req.params.pathId,
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  },

  /**
   * Get bottlenecks for a learning path
   * GET /api/v1/analytics/paths/:pathId/bottlenecks
   */
  async getBottlenecks(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { pathId } = req.params as Record<string, string>;
      const timeframe = (req.query.timeframe as string) || 'all';

      // Get milestone analytics first
      const timeFilter = LearningAnalyticsService['getTimeFilter'](timeframe as string);
      const milestoneAnalytics = await LearningAnalyticsService.getMilestoneAnalytics(pathId, timeFilter);

      // Identify bottlenecks
      const bottlenecks = await LearningAnalyticsService.identifyBottlenecks(pathId, milestoneAnalytics);

      res.status(200).json({
        success: true,
        data: bottlenecks
      });
    } catch (error) {
      logger.error("Failed to get bottlenecks", {
        pathId: req.params.pathId,
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  },

  // ─── Real-Time Metrics ───────────────────────────────────────────────────

  /**
   * Get real-time engagement metrics
   * GET /api/v1/analytics/realtime/engagement
   */
  async getRealTimeEngagement(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const windowMinutes = parseInt(req.query.window as string) || 15;

      if (windowMinutes < 1 || windowMinutes > 60) {
        throw createError(ErrorCode.BAD_REQUEST, 400);
      }

      const metrics = await AdvancedAnalyticsService.getEngagementMetrics(
        req.user?.id || "",
        windowMinutes,
      );

      res.status(200).json({
        success: true,
        data: metrics
      });
    } catch (error) {
      logger.error("Failed to get real-time engagement", {
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  },

  /**
   * Get real-time revenue stream
   * GET /api/v1/analytics/realtime/revenue
   */
  async getRealTimeRevenueStream(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const windowMinutes = parseInt(req.query.window as string) || 15;

      if (windowMinutes < 1 || windowMinutes > 60) {
        throw createError(ErrorCode.BAD_REQUEST, 400);
      }

      const stream = await AdvancedAnalyticsService.getRealTimeRevenueStream(windowMinutes);

      res.status(200).json({
        success: true,
        data: stream
      });
    } catch (error) {
      logger.error("Failed to get real-time revenue stream", {
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  },

  // ─── Custom Reporting ────────────────────────────────────────────────────

  /**
   * Generate a custom analytics report
   * POST /api/v1/analytics/reports/custom
   */
  async generateCustomReport(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw createError(ErrorCode.AUTH_AUTHENTICATION_REQUIRED, 401);
      }

      const { metrics, dateRange, filters, groupBy } = req.body;

      if (!metrics || !Array.isArray(metrics) || metrics.length === 0) {
        throw createError(ErrorCode.BAD_REQUEST, 400);
      }

      if (!dateRange || !dateRange.start || !dateRange.end) {
        throw createError(ErrorCode.BAD_REQUEST, 400);
      }

      const validMetrics = ["revenue", "sessions", "users"];
      const invalidMetrics = metrics.filter((m: string) => !validMetrics.includes(m));
      if (invalidMetrics.length > 0) {
        throw createError(ErrorCode.BAD_REQUEST, 400);
      }

      const report = await AdvancedAnalyticsService.generateCustomReport({
        userId,
        metrics,
        dateRange,
        filters,
        groupBy,
      });

      res.status(200).json({
        success: true,
        data: report
      });
    } catch (error) {
      logger.error("Failed to generate custom report", {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  },

  /**
   * Export analytics data to CSV
   * GET /api/v1/analytics/export/csv
   */
  async exportToCSV(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { metric, startDate, endDate } = req.query;

      if (!metric || !startDate || !endDate) {
        throw createError(ErrorCode.BAD_REQUEST, 400);
      }

      const start = new Date(startDate as string);
      const end = new Date(endDate as string);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        throw createError(ErrorCode.BAD_REQUEST, 400);
      }

      const csv = await AdvancedAnalyticsService.exportToCSV(
        metric as string,
        start,
        end,
      );

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${metric}-${startDate}-${endDate}.csv"`,
      );
      res.status(200).send(csv);
    } catch (error) {
      logger.error("Failed to export CSV", {
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  },

  /**
   * Get comparative analytics between two periods
   * GET /api/v1/analytics/compare
   */
  async getComparativeAnalytics(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { metric, currentPeriod, previousPeriod } = req.query;

      if (!metric || !currentPeriod || !previousPeriod) {
        throw createError(ErrorCode.BAD_REQUEST, 400);
      }

      const validMetrics = ["revenue", "sessions", "users"];
      if (!validMetrics.includes(metric as string)) {
        throw createError(ErrorCode.BAD_REQUEST, 400);
      }

      const comparison = await AdvancedAnalyticsService.getComparativeAnalytics(
        metric as string,
        currentPeriod as string,
        previousPeriod as string,
      );

      res.status(200).json({
        success: true,
        data: comparison
      });
    } catch (error) {
      logger.error("Failed to get comparative analytics", {
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  },

  /**
   * Get engagement funnel
   * GET /api/v1/analytics/funnel
   */
  async getEngagementFunnel(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { startDate, endDate } = req.query;

      const start = startDate
        ? new Date(startDate as string)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const end = endDate ? new Date(endDate as string) : new Date();

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        throw createError(ErrorCode.BAD_REQUEST, 400);
      }

      const funnel = await AdvancedAnalyticsService.getEngagementFunnel(start, end);

      res.status(200).json({
        success: true,
        data: funnel
      });
    } catch (error) {
      logger.error("Failed to get engagement funnel", {
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  },

  // ─── AI Recommendations ──────────────────────────────────────────────────

  /**
   * Get AI-powered learning path recommendations
   * GET /api/v1/analytics/recommendations/paths
   */
  async getPathRecommendations(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw createError(ErrorCode.AUTH_AUTHENTICATION_REQUIRED, 401);
      }

      const limit = parseInt(req.query.limit as string) || 5;
      const difficulty = req.query.difficulty as string | undefined;
      const maxDurationWeeks = req.query.maxDurationWeeks
        ? parseInt(req.query.maxDurationWeeks as string)
        : undefined;

      if (limit < 1 || limit > 20) {
        throw createError(ErrorCode.BAD_REQUEST, 400);
      }

      const result = await AIRecommendationsService.getRecommendations({
        userId,
        limit,
        filters: {
          difficulty: difficulty as "beginner" | "intermediate" | "advanced" | undefined,
          maxDurationWeeks,
        },
      });

      res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error("Failed to get path recommendations", {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  },

  /**
   * Get outcome predictions for learning paths
   * GET /api/v1/analytics/recommendations/predictions
   */
  async getOutcomePredictions(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw createError(ErrorCode.AUTH_AUTHENTICATION_REQUIRED, 401);
      }

      const pathIds = req.query.pathIds as string;
      if (!pathIds) {
        throw createError(ErrorCode.BAD_REQUEST, 400);
      }

      const pathIdArray = pathIds.split(",").map((id) => id.trim());
      if (pathIdArray.length === 0 || pathIdArray.length > 10) {
        throw createError(ErrorCode.BAD_REQUEST, 400);
      }

      const predictions = await AIRecommendationsService.predictOutcomes(
        userId,
        pathIdArray,
      );

      res.status(200).json({
        success: true,
        data: predictions
      });
    } catch (error) {
      logger.error("Failed to get outcome predictions", {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  },

  /**
   * Record a learning path interaction
   * POST /api/v1/analytics/recommendations/interactions
   */
  async recordPathInteraction(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw createError(ErrorCode.AUTH_AUTHENTICATION_REQUIRED, 401);
      }

      const { pathId, action, metadata } = req.body;

      if (!pathId || !action) {
        throw createError(ErrorCode.BAD_REQUEST, 400);
      }

      const validActions = ["viewed", "enrolled", "completed", "abandoned"];
      if (!validActions.includes(action)) {
        throw createError(ErrorCode.BAD_REQUEST, 400);
      }

      await AIRecommendationsService.recordInteraction(
        userId,
        pathId,
        action,
        metadata,
      );

      res.status(200).json({
        success: true,
        message: "Interaction recorded"
      });
    } catch (error) {
      logger.error("Failed to record path interaction", {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : error
      });
      next(error);
    }
  },
};
