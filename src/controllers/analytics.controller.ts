import { Request, Response, NextFunction } from "express";
import { LearningAnalyticsService } from "../services/learning-analytics.service";
import { logger } from "../utils/logger.utils";
import { createError } from "../middleware/errorHandler";

export const AnalyticsController = {
  /**
   * Get comprehensive analytics for a learning path
   * GET /api/v1/analytics/paths/:pathId
   */
  async getPathAnalytics(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { pathId } = req.params;
      const { timeframe = 'all' } = req.query;

      if (!['week', 'month', 'quarter', 'year', 'all'].includes(timeframe as string)) {
        throw createError("Invalid timeframe. Must be one of: week, month, quarter, year, all", 400);
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
  async getStudentProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { studentId } = req.params;
      const { pathId } = req.query;

      // Verify access: students can only view their own profile, mentors can view their students
      const requestingUserId = req.user?.id;
      const requestingUserRole = req.user?.role;

      if (requestingUserRole !== 'admin' && requestingUserRole !== 'mentor' && requestingUserId !== studentId) {
        throw createError("Access denied", 403);
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
  async getPredictiveInsights(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { studentId, pathId } = req.params;

      // Verify access
      const requestingUserId = req.user?.id;
      const requestingUserRole = req.user?.role;

      if (requestingUserRole !== 'admin' && requestingUserRole !== 'mentor' && requestingUserId !== studentId) {
        throw createError("Access denied", 403);
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
  async getComparisonAnalytics(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { studentId, pathId } = req.params;

      // Verify access
      const requestingUserId = req.user?.id;
      const requestingUserRole = req.user?.role;

      if (requestingUserRole !== 'admin' && requestingUserRole !== 'mentor' && requestingUserId !== studentId) {
        throw createError("Access denied", 403);
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
  async getMentorDashboard(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { mentorId } = req.params;

      // Verify access: only the mentor themselves or admins can view
      const requestingUserId = req.user?.id;
      const requestingUserRole = req.user?.role;

      if (requestingUserRole !== 'admin' && requestingUserId !== mentorId) {
        throw createError("Access denied", 403);
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
      const { pathId } = req.params;
      const { timeframe = 'all' } = req.query;

      if (!['week', 'month', 'quarter', 'year', 'all'].includes(timeframe as string)) {
        throw createError("Invalid timeframe. Must be one of: week, month, quarter, year, all", 400);
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
      const { pathId } = req.params;
      const { timeframe = 'month' } = req.query;

      if (!['week', 'month', 'quarter', 'year', 'all'].includes(timeframe as string)) {
        throw createError("Invalid timeframe. Must be one of: week, month, quarter, year, all", 400);
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
      const { pathId } = req.params;
      const { timeframe = 'all' } = req.query;

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
  }
};
