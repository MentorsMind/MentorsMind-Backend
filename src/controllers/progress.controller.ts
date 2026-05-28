import { Request, Response } from "express";
import { ProgressTrackingService } from "../services/progress-tracking.service";
import { EnrollmentService } from "../services/enrollment.service";
import { MilestoneCompletionService } from "../services/milestone-completion.service";
import { StudentDashboardService } from "../services/student-dashboard.service";
import { EnrollmentModel } from "../models/enrollment.model";
import { 
  UpdateEnrollmentStatusSchema,
  CompleteMilestoneSchema
} from "../models/learning-path.model";
import { logger } from "../utils/logger.utils";
import { createError } from "../middleware/errorHandler";
import { z } from "zod";

export const ProgressController = {
  /**
   * Get detailed enrollment with progress
   * GET /api/v1/enrollments/:enrollmentId
   */
  async getEnrollmentDetails(req: Request, res: Response): Promise<void> {
    try {
      const { enrollmentId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        throw createError("Authentication required", 401);
      }

      if (!enrollmentId) {
        throw createError("Enrollment ID is required", 400);
      }

      // Verify user has access to this enrollment
      const enrollment = await EnrollmentModel.findById(enrollmentId);
      if (!enrollment) {
        throw createError("Enrollment not found", 404);
      }

      if (enrollment.student_id !== userId) {
        throw createError("Access denied", 403);
      }

      const progress = await ProgressTrackingService.getStudentProgress(enrollmentId);
      
      res.json({
        success: true,
        data: progress
      });
    } catch (error) {
      logger.error("Failed to get enrollment details via API", {
        enrollmentId: req.params.enrollmentId,
        userId: req.user?.id,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Update enrollment status (pause/resume/cancel)
   * PATCH /api/v1/enrollments/:enrollmentId/status
   */
  async updateEnrollmentStatus(req: Request, res: Response): Promise<void> {
    try {
      const { enrollmentId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        throw createError("Authentication required", 401);
      }

      if (!enrollmentId) {
        throw createError("Enrollment ID is required", 400);
      }

      const validatedData = UpdateEnrollmentStatusSchema.parse(req.body);

      // Verify user has access to this enrollment
      const enrollment = await EnrollmentModel.findById(enrollmentId);
      if (!enrollment) {
        throw createError("Enrollment not found", 404);
      }

      if (enrollment.student_id !== userId) {
        throw createError("Access denied", 403);
      }

      const updatedEnrollment = await EnrollmentModel.updateStatus(enrollmentId, validatedData);
      if (!updatedEnrollment) {
        throw createError("Failed to update enrollment status", 500);
      }

      logger.info("Enrollment status updated via API", {
        enrollmentId,
        userId,
        newStatus: validatedData.status,
        reason: validatedData.reason
      });

      res.json({
        success: true,
        data: EnrollmentModel.transformToEnrollment(updatedEnrollment),
        message: "Enrollment status updated successfully"
      });
    } catch (error) {
      logger.error("Failed to update enrollment status via API", {
        enrollmentId: req.params.enrollmentId,
        userId: req.user?.id,
        error: error instanceof Error ? error.message : error
      });

      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          errors: error.errors
        });
        return;
      }

      throw error;
    }
  },

  /**
   * Complete a milestone
   * POST /api/v1/enrollments/:enrollmentId/milestones/:milestoneId/complete
   */
  async completeMilestone(req: Request, res: Response): Promise<void> {
    try {
      const { enrollmentId, milestoneId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        throw createError("Authentication required", 401);
      }

      if (!enrollmentId || !milestoneId) {
        throw createError("Enrollment ID and Milestone ID are required", 400);
      }

      const validatedData = CompleteMilestoneSchema.parse(req.body);

      // Verify user has access to this enrollment
      const enrollment = await EnrollmentModel.findById(enrollmentId);
      if (!enrollment) {
        throw createError("Enrollment not found", 404);
      }

      if (enrollment.student_id !== userId) {
        throw createError("Access denied", 403);
      }

      const completion = await MilestoneCompletionService.completeMilestone(
        enrollmentId, 
        milestoneId, 
        validatedData
      );

      logger.info("Milestone completed via API", {
        enrollmentId,
        milestoneId,
        userId,
        pathCompleted: completion.pathCompleted
      });

      res.json({
        success: true,
        data: completion,
        message: completion.pathCompleted 
          ? "Milestone completed! Congratulations on finishing the learning path!" 
          : "Milestone completed successfully"
      });
    } catch (error) {
      logger.error("Failed to complete milestone via API", {
        enrollmentId: req.params.enrollmentId,
        milestoneId: req.params.milestoneId,
        userId: req.user?.id,
        error: error instanceof Error ? error.message : error
      });

      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          message: "Validation error",
          errors: error.errors
        });
        return;
      }

      throw error;
    }
  },

  /**
   * Get detailed progress information
   * GET /api/v1/enrollments/:enrollmentId/progress
   */
  async getProgress(req: Request, res: Response): Promise<void> {
    try {
      const { enrollmentId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        throw createError("Authentication required", 401);
      }

      if (!enrollmentId) {
        throw createError("Enrollment ID is required", 400);
      }

      // Verify user has access to this enrollment
      const enrollment = await EnrollmentModel.findById(enrollmentId);
      if (!enrollment) {
        throw createError("Enrollment not found", 404);
      }

      if (enrollment.student_id !== userId) {
        throw createError("Access denied", 403);
      }

      const progress = await ProgressTrackingService.getStudentProgress(enrollmentId);
      const insights = await ProgressTrackingService.getProgressInsights(enrollmentId);
      
      res.json({
        success: true,
        data: {
          ...progress,
          insights
        }
      });
    } catch (error) {
      logger.error("Failed to get progress via API", {
        enrollmentId: req.params.enrollmentId,
        userId: req.user?.id,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Update milestone progress
   * PATCH /api/v1/enrollments/:enrollmentId/milestones/:milestoneId/progress
   */
  async updateMilestoneProgress(req: Request, res: Response): Promise<void> {
    try {
      const { enrollmentId, milestoneId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        throw createError("Authentication required", 401);
      }

      if (!enrollmentId || !milestoneId) {
        throw createError("Enrollment ID and Milestone ID are required", 400);
      }

      const { progress, timeSpentMinutes } = req.body;

      if (typeof progress !== 'number' || progress < 0 || progress > 100) {
        throw createError("Progress must be a number between 0 and 100", 400);
      }

      // Verify user has access to this enrollment
      const enrollment = await EnrollmentModel.findById(enrollmentId);
      if (!enrollment) {
        throw createError("Enrollment not found", 404);
      }

      if (enrollment.student_id !== userId) {
        throw createError("Access denied", 403);
      }

      await ProgressTrackingService.updateProgress(
        enrollmentId, 
        milestoneId, 
        progress, 
        timeSpentMinutes
      );

      logger.info("Milestone progress updated via API", {
        enrollmentId,
        milestoneId,
        userId,
        progress,
        timeSpentMinutes
      });

      res.json({
        success: true,
        message: "Progress updated successfully"
      });
    } catch (error) {
      logger.error("Failed to update milestone progress via API", {
        enrollmentId: req.params.enrollmentId,
        milestoneId: req.params.milestoneId,
        userId: req.user?.id,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Get learning path analytics (mentor only)
   * GET /api/v1/learning-paths/:pathId/analytics
   */
  async getPathAnalytics(req: Request, res: Response): Promise<void> {
    try {
      const { pathId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        throw createError("Authentication required", 401);
      }

      if (!pathId) {
        throw createError("Path ID is required", 400);
      }

      // Verify user is the mentor of this path
      // This would need to be implemented in the learning path service
      // For now, we'll get the analytics directly
      
      const analytics = await ProgressTrackingService.getPathAnalytics(pathId);
      
      res.json({
        success: true,
        data: analytics
      });
    } catch (error) {
      logger.error("Failed to get path analytics via API", {
        pathId: req.params.pathId,
        userId: req.user?.id,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Get student dashboard data
   * GET /api/v1/analytics/student-dashboard
   */
  async getStudentDashboard(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;

      if (!userId) {
        throw createError("Authentication required", 401);
      }

      const dashboardData = await StudentDashboardService.getDashboardData(userId);
      
      res.json({
        success: true,
        data: dashboardData
      });
    } catch (error) {
      logger.error("Failed to get student dashboard via API", {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Get mentor dashboard data
   * GET /api/v1/analytics/mentor-dashboard
   */
  async getMentorDashboard(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;

      if (!userId) {
        throw createError("Authentication required", 401);
      }

      // This would aggregate data from mentor's learning paths
      // For now, return a placeholder structure
      
      res.json({
        success: true,
        data: {
          totalPaths: 0,
          publishedPaths: 0,
          totalEnrollments: 0,
          activeStudents: 0,
          completionRate: 0,
          totalRevenue: 0,
          averageRating: 0,
          recentEnrollments: [],
          topPerformingPaths: [],
          studentProgress: []
        }
      });
    } catch (error) {
      logger.error("Failed to get mentor dashboard via API", {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  }
};