import { Request, Response } from "express";
import { LearningPathService } from "../services/learning-path.service";
import { EnrollmentService } from "../services/enrollment.service";
import { ProgressTrackingService } from "../services/progress-tracking.service";
import { 
  CreateLearningPathSchema, 
  UpdateLearningPathSchema,
  CreateEnrollmentSchema,
  UpdateEnrollmentStatusSchema,
  CompleteMilestoneSchema,
  CreatePathReviewSchema
} from "../models/learning-path.model";
import { logger } from "../utils/logger.utils";
import { createError } from "../middleware/errorHandler";
import { z } from "zod";

// Query parameter schemas
const PathFiltersSchema = z.object({
  isPublished: z.string().transform(val => val === 'true').optional(),
  isTemplate: z.string().transform(val => val === 'true').optional(),
  difficultyLevel: z.enum(['beginner', 'intermediate', 'advanced', 'expert']).optional(),
  tags: z.string().transform(val => val.split(',')).optional(),
  mentorId: z.string().uuid().optional(),
  page: z.string().transform(val => parseInt(val, 10)).optional(),
  limit: z.string().transform(val => parseInt(val, 10)).optional(),
});

const EnrollmentFiltersSchema = z.object({
  status: z.enum(['active', 'paused', 'completed', 'cancelled']).optional(),
  page: z.string().transform(val => parseInt(val, 10)).optional(),
  limit: z.string().transform(val => parseInt(val, 10)).optional(),
});

export const LearningPathController = {
  /**
   * Create a new learning path
   * POST /api/v1/learning-paths
   */
  async createPath(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw createError("Authentication required", 401);
      }

      const validatedData = CreateLearningPathSchema.parse(req.body);
      
      const learningPath = await LearningPathService.createPath(userId, validatedData);
      
      logger.info("Learning path created via API", {
        pathId: learningPath.id,
        mentorId: userId,
        title: learningPath.title
      });

      res.status(201).json({
        success: true,
        data: learningPath,
        message: "Learning path created successfully"
      });
    } catch (error) {
      logger.error("Failed to create learning path via API", {
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
   * Get learning path by ID
   * GET /api/v1/learning-paths/:pathId
   */
  async getPath(req: Request, res: Response): Promise<void> {
    try {
      const { pathId } = req.params;
      const userId = req.user?.id;

      if (!pathId) {
        throw createError("Path ID is required", 400);
      }

      const learningPath = await LearningPathService.getPath(pathId, userId);
      
      if (!learningPath) {
        throw createError("Learning path not found", 404);
      }

      // Check access permissions for unpublished paths
      if (!learningPath.is_published && learningPath.mentor_id !== userId) {
        throw createError("Access denied", 403);
      }

      res.json({
        success: true,
        data: learningPath
      });
    } catch (error) {
      logger.error("Failed to get learning path via API", {
        pathId: req.params.pathId,
        userId: req.user?.id,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Update learning path
   * PUT /api/v1/learning-paths/:pathId
   */
  async updatePath(req: Request, res: Response): Promise<void> {
    try {
      const { pathId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        throw createError("Authentication required", 401);
      }

      if (!pathId) {
        throw createError("Path ID is required", 400);
      }

      const validatedData = UpdateLearningPathSchema.parse(req.body);
      
      const updatedPath = await LearningPathService.updatePath(pathId, userId, validatedData);
      
      logger.info("Learning path updated via API", {
        pathId,
        mentorId: userId,
        updates: Object.keys(validatedData)
      });

      res.json({
        success: true,
        data: updatedPath,
        message: "Learning path updated successfully"
      });
    } catch (error) {
      logger.error("Failed to update learning path via API", {
        pathId: req.params.pathId,
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
   * Delete learning path
   * DELETE /api/v1/learning-paths/:pathId
   */
  async deletePath(req: Request, res: Response): Promise<void> {
    try {
      const { pathId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        throw createError("Authentication required", 401);
      }

      if (!pathId) {
        throw createError("Path ID is required", 400);
      }

      await LearningPathService.deletePath(pathId, userId);
      
      logger.info("Learning path deleted via API", {
        pathId,
        mentorId: userId
      });

      res.json({
        success: true,
        message: "Learning path deleted successfully"
      });
    } catch (error) {
      logger.error("Failed to delete learning path via API", {
        pathId: req.params.pathId,
        userId: req.user?.id,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Get learning paths (with filters)
   * GET /api/v1/learning-paths
   */
  async getPaths(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const filters = PathFiltersSchema.parse(req.query);

      // If mentorId filter is provided, get mentor's paths
      if (filters.mentorId) {
        // Check if user can access mentor's paths
        if (filters.mentorId !== userId) {
          // Only allow access to published paths for other mentors
          filters.isPublished = true;
        }

        const result = await LearningPathService.getMentorPaths(filters.mentorId, filters);
        
        res.json({
          success: true,
          data: result.paths,
          pagination: {
            total: result.total,
            page: filters.page || 1,
            limit: filters.limit || 10
          }
        });
        return;
      }

      // Get published paths for discovery
      const result = await LearningPathService.getPublishedPaths(filters);
      
      res.json({
        success: true,
        data: result.paths,
        pagination: {
          total: result.total,
          page: filters.page || 1,
          limit: filters.limit || 10
        }
      });
    } catch (error) {
      logger.error("Failed to get learning paths via API", {
        userId: req.user?.id,
        query: req.query,
        error: error instanceof Error ? error.message : error
      });

      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          message: "Invalid query parameters",
          errors: error.errors
        });
        return;
      }

      throw error;
    }
  },

  /**
   * Publish learning path
   * POST /api/v1/learning-paths/:pathId/publish
   */
  async publishPath(req: Request, res: Response): Promise<void> {
    try {
      const { pathId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        throw createError("Authentication required", 401);
      }

      if (!pathId) {
        throw createError("Path ID is required", 400);
      }

      const publishedPath = await LearningPathService.publishPath(pathId, userId);
      
      logger.info("Learning path published via API", {
        pathId,
        mentorId: userId
      });

      res.json({
        success: true,
        data: publishedPath,
        message: "Learning path published successfully"
      });
    } catch (error) {
      logger.error("Failed to publish learning path via API", {
        pathId: req.params.pathId,
        userId: req.user?.id,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Unpublish learning path
   * DELETE /api/v1/learning-paths/:pathId/publish
   */
  async unpublishPath(req: Request, res: Response): Promise<void> {
    try {
      const { pathId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        throw createError("Authentication required", 401);
      }

      if (!pathId) {
        throw createError("Path ID is required", 400);
      }

      const unpublishedPath = await LearningPathService.unpublishPath(pathId, userId);
      
      logger.info("Learning path unpublished via API", {
        pathId,
        mentorId: userId
      });

      res.json({
        success: true,
        data: unpublishedPath,
        message: "Learning path unpublished successfully"
      });
    } catch (error) {
      logger.error("Failed to unpublish learning path via API", {
        pathId: req.params.pathId,
        userId: req.user?.id,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Clone learning path from template
   * POST /api/v1/learning-paths/:pathId/clone
   */
  async clonePath(req: Request, res: Response): Promise<void> {
    try {
      const { pathId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        throw createError("Authentication required", 401);
      }

      if (!pathId) {
        throw createError("Path ID is required", 400);
      }

      // Get the template path
      const templatePath = await LearningPathService.getPath(pathId);
      if (!templatePath) {
        throw createError("Template path not found", 404);
      }

      if (!templatePath.is_template && !templatePath.is_published) {
        throw createError("Path is not available for cloning", 400);
      }

      // Create new path based on template
      const cloneData = {
        title: `${templatePath.title} (Copy)`,
        description: templatePath.description,
        estimatedDurationHours: templatePath.estimated_duration_hours,
        difficultyLevel: templatePath.difficulty_level as any,
        totalPrice: templatePath.total_price || undefined,
        pricingModel: templatePath.pricing_model as any,
        currency: templatePath.currency,
        tags: templatePath.tags,
        milestones: templatePath.milestones || []
      };

      const clonedPath = await LearningPathService.createPath(userId, cloneData);
      
      logger.info("Learning path cloned via API", {
        originalPathId: pathId,
        clonedPathId: clonedPath.id,
        mentorId: userId
      });

      res.status(201).json({
        success: true,
        data: clonedPath,
        message: "Learning path cloned successfully"
      });
    } catch (error) {
      logger.error("Failed to clone learning path via API", {
        pathId: req.params.pathId,
        userId: req.user?.id,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Enroll in learning path
   * POST /api/v1/learning-paths/:pathId/enroll
   */
  async enrollInPath(req: Request, res: Response): Promise<void> {
    try {
      const { pathId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        throw createError("Authentication required", 401);
      }

      if (!pathId) {
        throw createError("Path ID is required", 400);
      }

      const enrollmentData = CreateEnrollmentSchema.parse(req.body);
      
      const enrollment = await EnrollmentService.enrollStudent(pathId, userId, enrollmentData);
      
      logger.info("Student enrolled in learning path via API", {
        pathId,
        studentId: userId,
        enrollmentId: enrollment.id
      });

      res.status(201).json({
        success: true,
        data: enrollment,
        message: "Successfully enrolled in learning path"
      });
    } catch (error) {
      logger.error("Failed to enroll in learning path via API", {
        pathId: req.params.pathId,
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
   * Unenroll from learning path
   * DELETE /api/v1/learning-paths/:pathId/enroll
   */
  async unenrollFromPath(req: Request, res: Response): Promise<void> {
    try {
      const { pathId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        throw createError("Authentication required", 401);
      }

      if (!pathId) {
        throw createError("Path ID is required", 400);
      }

      await EnrollmentService.unenrollStudent(pathId, userId);
      
      logger.info("Student unenrolled from learning path via API", {
        pathId,
        studentId: userId
      });

      res.json({
        success: true,
        message: "Successfully unenrolled from learning path"
      });
    } catch (error) {
      logger.error("Failed to unenroll from learning path via API", {
        pathId: req.params.pathId,
        userId: req.user?.id,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Get enrollments for a learning path (mentor only)
   * GET /api/v1/learning-paths/:pathId/enrollments
   */
  async getPathEnrollments(req: Request, res: Response): Promise<void> {
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
      const learningPath = await LearningPathService.getPath(pathId);
      if (!learningPath || learningPath.mentor_id !== userId) {
        throw createError("Access denied", 403);
      }

      const filters = EnrollmentFiltersSchema.parse(req.query);
      const result = await EnrollmentService.getPathEnrollments(pathId, userId, filters);
      
      res.json({
        success: true,
        data: result.enrollments,
        pagination: {
          total: result.total,
          page: filters.page || 1,
          limit: filters.limit || 10
        }
      });
    } catch (error) {
      logger.error("Failed to get path enrollments via API", {
        pathId: req.params.pathId,
        userId: req.user?.id,
        error: error instanceof Error ? error.message : error
      });

      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          message: "Invalid query parameters",
          errors: error.errors
        });
        return;
      }

      throw error;
    }
  },

  /**
   * Get user's enrollments
   * GET /api/v1/enrollments
   */
  async getUserEnrollments(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;

      if (!userId) {
        throw createError("Authentication required", 401);
      }

      const filters = EnrollmentFiltersSchema.parse(req.query);
      const result = await EnrollmentService.getStudentEnrollments(userId, filters);
      
      res.json({
        success: true,
        data: result.enrollments,
        pagination: {
          total: result.total,
          page: filters.page || 1,
          limit: filters.limit || 10
        }
      });
    } catch (error) {
      logger.error("Failed to get user enrollments via API", {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : error
      });

      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          message: "Invalid query parameters",
          errors: error.errors
        });
        return;
      }

      throw error;
    }
  }
};