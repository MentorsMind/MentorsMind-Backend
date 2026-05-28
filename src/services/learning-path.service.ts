import { LearningPathModel, LearningPathRecord, CreateLearningPathData, UpdateLearningPathData } from "../models/learning-path.model";
import { MilestoneModel } from "../models/milestone.model";
import { EnrollmentModel, MilestoneProgressModel } from "../models/enrollment.model";
import { CacheService } from "./cache.service";
import { CacheKeys, CacheTTL } from "../utils/cache-key.utils";
import { logger } from "../utils/logger.utils";
import { createError } from "../middleware/errorHandler";
import pool from "../config/database";

export interface CreatePathData extends CreateLearningPathData {
  mentorId: string;
}

export interface UpdatePathData extends UpdateLearningPathData {}

export interface PathFilters {
  isPublished?: boolean;
  isTemplate?: boolean;
  difficultyLevel?: string;
  tags?: string[];
  mentorId?: string;
  page?: number;
  limit?: number;
}

export interface LearningPathWithProgress extends LearningPathRecord {
  milestones?: any[];
  enrollment?: any;
  progress?: any;
}

export interface Enrollment {
  id: string;
  learningPathId: string;
  studentId: string;
  status: string;
  enrolledAt: string;
  paymentStatus: string;
}

export const LearningPathService = {
  /**
   * Create a new learning path with milestones
   */
  async createPath(mentorId: string, pathData: CreateLearningPathData): Promise<LearningPathRecord> {
    try {
      // Validate mentor exists and has mentor role
      const { rows: mentorRows } = await pool.query(
        `SELECT id, role, status FROM users WHERE id = $1 AND is_active = true`,
        [mentorId]
      );

      const mentor = mentorRows[0];
      if (!mentor) {
        throw createError("Mentor not found", 404);
      }

      if (mentor.role !== "mentor") {
        throw createError("User is not a mentor", 400);
      }

      if (mentor.status === "suspended" || mentor.status === "banned") {
        throw createError("Mentor account is not active", 403);
      }

      // Create learning path with milestones
      const learningPath = await LearningPathModel.create({
        ...pathData,
        mentorId
      });

      // Invalidate mentor's path cache
      await CacheService.del(CacheKeys.mentorPaths(mentorId));
      
      logger.info("Learning path created", {
        pathId: learningPath.id,
        mentorId,
        title: learningPath.title,
        milestoneCount: pathData.milestones.length
      });

      return learningPath;
    } catch (error) {
      logger.error("Failed to create learning path", {
        mentorId,
        title: pathData.title,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Update an existing learning path
   */
  async updatePath(pathId: string, mentorId: string, updates: UpdatePathData): Promise<LearningPathRecord> {
    try {
      // Verify path exists and belongs to mentor
      const existingPath = await this.getPath(pathId, mentorId);
      if (!existingPath) {
        throw createError("Learning path not found", 404);
      }

      if (existingPath.mentor_id !== mentorId) {
        throw createError("Access denied", 403);
      }

      // Check if path has active enrollments for certain updates
      if (updates.milestones && existingPath.enrolled_count > 0) {
        throw createError("Cannot modify milestones for paths with active enrollments", 400);
      }

      const updatedPath = await LearningPathModel.update(pathId, updates);
      if (!updatedPath) {
        throw createError("Failed to update learning path", 500);
      }

      // Invalidate caches
      await Promise.all([
        CacheService.del(CacheKeys.learningPath(pathId)),
        CacheService.del(CacheKeys.mentorPaths(mentorId)),
        CacheService.del(CacheKeys.publishedPaths())
      ]);

      logger.info("Learning path updated", {
        pathId,
        mentorId,
        updates: Object.keys(updates)
      });

      return updatedPath;
    } catch (error) {
      logger.error("Failed to update learning path", {
        pathId,
        mentorId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Delete a learning path
   */
  async deletePath(pathId: string, mentorId: string): Promise<void> {
    try {
      const existingPath = await this.getPath(pathId, mentorId);
      if (!existingPath) {
        throw createError("Learning path not found", 404);
      }

      if (existingPath.mentor_id !== mentorId) {
        throw createError("Access denied", 403);
      }

      // Check for active enrollments
      if (existingPath.enrolled_count > 0) {
        throw createError("Cannot delete learning path with active enrollments", 400);
      }

      const deleted = await LearningPathModel.delete(pathId);
      if (!deleted) {
        throw createError("Failed to delete learning path", 500);
      }

      // Invalidate caches
      await Promise.all([
        CacheService.del(CacheKeys.learningPath(pathId)),
        CacheService.del(CacheKeys.mentorPaths(mentorId)),
        CacheService.del(CacheKeys.publishedPaths())
      ]);

      logger.info("Learning path deleted", { pathId, mentorId });
    } catch (error) {
      logger.error("Failed to delete learning path", {
        pathId,
        mentorId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Get a learning path by ID with optional progress for enrolled user
   */
  async getPath(pathId: string, userId?: string): Promise<LearningPathWithProgress | null> {
    try {
      const cacheKey = CacheKeys.learningPath(pathId);
      
      // Try cache first for basic path data
      let learningPath = await CacheService.get<LearningPathRecord>(cacheKey);
      
      if (!learningPath) {
        learningPath = await LearningPathModel.findById(pathId);
        if (!learningPath) {
          return null;
        }
        
        // Cache for 5 minutes
        await CacheService.set(cacheKey, learningPath, CacheTTL.short);
      }

      // Get milestones
      const milestones = await MilestoneModel.getMilestonesByPath(pathId, true);
      
      const result: LearningPathWithProgress = {
        ...learningPath,
        milestones
      };

      // If user provided, get enrollment and progress data
      if (userId) {
        const enrollment = await EnrollmentModel.findByStudentAndPath(userId, pathId);
        if (enrollment) {
          const progress = await MilestoneProgressModel.findByEnrollmentId(enrollment.id);
          result.enrollment = EnrollmentModel.transformToEnrollment(enrollment);
          result.progress = progress.map(p => MilestoneProgressModel.transformToProgress(p));
        }
      }

      return result;
    } catch (error) {
      logger.error("Failed to get learning path", {
        pathId,
        userId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Get learning paths for a mentor
   */
  async getMentorPaths(mentorId: string, filters: PathFilters = {}): Promise<{ paths: LearningPathRecord[]; total: number }> {
    try {
      const cacheKey = CacheKeys.mentorPaths(mentorId);
      
      // For simple queries without filters, use cache
      if (!filters.isPublished && !filters.isTemplate && !filters.page) {
        const cached = await CacheService.get<{ paths: LearningPathRecord[]; total: number }>(cacheKey);
        if (cached) {
          logger.debug("Mentor paths cache hit", { mentorId });
          return cached;
        }
      }

      const result = await LearningPathModel.findByMentorId(mentorId, filters);

      // Cache simple queries
      if (!filters.isPublished && !filters.isTemplate && !filters.page) {
        await CacheService.set(cacheKey, result, CacheTTL.short);
      }

      return result;
    } catch (error) {
      logger.error("Failed to get mentor paths", {
        mentorId,
        filters,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Enroll a student in a learning path
   */
  async enrollStudent(pathId: string, studentId: string, paymentData?: any): Promise<Enrollment> {
    try {
      // Validate learning path exists and is published
      const learningPath = await LearningPathModel.findById(pathId);
      if (!learningPath) {
        throw createError("Learning path not found", 404);
      }

      if (!learningPath.is_published) {
        throw createError("Learning path is not published", 400);
      }

      // Validate student exists
      const { rows: studentRows } = await pool.query(
        `SELECT id, status FROM users WHERE id = $1 AND is_active = true`,
        [studentId]
      );

      const student = studentRows[0];
      if (!student) {
        throw createError("Student not found", 404);
      }

      if (student.status === "suspended" || student.status === "banned") {
        throw createError("Student account is not active", 403);
      }

      // Check if already enrolled
      const existingEnrollment = await EnrollmentModel.findByStudentAndPath(studentId, pathId);
      if (existingEnrollment) {
        throw createError("Student is already enrolled in this learning path", 409);
      }

      // Create enrollment
      const enrollmentRecord = await EnrollmentModel.create(pathId, studentId, paymentData || {});
      
      // Initialize milestone progress records
      const milestones = await MilestoneModel.findByLearningPathId(pathId);
      for (const milestone of milestones) {
        await MilestoneProgressModel.create(enrollmentRecord.id, milestone.id);
      }

      // Invalidate caches
      await Promise.all([
        CacheService.del(CacheKeys.learningPath(pathId)),
        CacheService.del(CacheKeys.studentEnrollments(studentId)),
        CacheService.del(CacheKeys.pathEnrollments(pathId))
      ]);

      const enrollment: Enrollment = {
        id: enrollmentRecord.id,
        learningPathId: enrollmentRecord.learning_path_id,
        studentId: enrollmentRecord.student_id,
        status: enrollmentRecord.status,
        enrolledAt: enrollmentRecord.enrolled_at.toISOString(),
        paymentStatus: enrollmentRecord.payment_status
      };

      logger.info("Student enrolled in learning path", {
        pathId,
        studentId,
        enrollmentId: enrollment.id
      });

      return enrollment;
    } catch (error) {
      logger.error("Failed to enroll student", {
        pathId,
        studentId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Unenroll a student from a learning path
   */
  async unenrollStudent(pathId: string, studentId: string): Promise<void> {
    try {
      const enrollment = await EnrollmentModel.findByStudentAndPath(studentId, pathId);
      if (!enrollment) {
        throw createError("Enrollment not found", 404);
      }

      // Update status to cancelled
      await EnrollmentModel.updateStatus(enrollment.id, { 
        status: 'cancelled',
        reason: 'Student unenrolled'
      });

      // Invalidate caches
      await Promise.all([
        CacheService.del(CacheKeys.learningPath(pathId)),
        CacheService.del(CacheKeys.studentEnrollments(studentId)),
        CacheService.del(CacheKeys.pathEnrollments(pathId))
      ]);

      logger.info("Student unenrolled from learning path", {
        pathId,
        studentId,
        enrollmentId: enrollment.id
      });
    } catch (error) {
      logger.error("Failed to unenroll student", {
        pathId,
        studentId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Get enrollments for a learning path
   */
  async getEnrollments(pathId: string, filters?: { status?: string; page?: number; limit?: number }): Promise<{ enrollments: any[]; total: number }> {
    try {
      const cacheKey = CacheKeys.pathEnrollments(pathId);
      
      // Use cache for simple queries
      if (!filters?.status && !filters?.page) {
        const cached = await CacheService.get<{ enrollments: any[]; total: number }>(cacheKey);
        if (cached) {
          logger.debug("Path enrollments cache hit", { pathId });
          return cached;
        }
      }

      const result = await EnrollmentModel.findByLearningPathId(pathId, filters);
      
      const enrollments = result.enrollments.map(e => EnrollmentModel.transformToEnrollment(e));

      const response = { enrollments, total: result.total };

      // Cache simple queries
      if (!filters?.status && !filters?.page) {
        await CacheService.set(cacheKey, response, CacheTTL.short);
      }

      return response;
    } catch (error) {
      logger.error("Failed to get enrollments", {
        pathId,
        filters,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Publish a learning path
   */
  async publishPath(pathId: string, mentorId: string): Promise<LearningPathRecord> {
    try {
      const existingPath = await this.getPath(pathId, mentorId);
      if (!existingPath) {
        throw createError("Learning path not found", 404);
      }

      if (existingPath.mentor_id !== mentorId) {
        throw createError("Access denied", 403);
      }

      if (existingPath.is_published) {
        throw createError("Learning path is already published", 400);
      }

      // Validate path is ready for publishing
      if (!existingPath.milestones || existingPath.milestones.length === 0) {
        throw createError("Learning path must have at least one milestone to publish", 400);
      }

      const publishedPath = await LearningPathModel.publish(pathId);
      if (!publishedPath) {
        throw createError("Failed to publish learning path", 500);
      }

      // Invalidate caches
      await Promise.all([
        CacheService.del(CacheKeys.learningPath(pathId)),
        CacheService.del(CacheKeys.mentorPaths(mentorId)),
        CacheService.del(CacheKeys.publishedPaths())
      ]);

      logger.info("Learning path published", { pathId, mentorId });

      return publishedPath;
    } catch (error) {
      logger.error("Failed to publish learning path", {
        pathId,
        mentorId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Unpublish a learning path
   */
  async unpublishPath(pathId: string, mentorId: string): Promise<LearningPathRecord> {
    try {
      const existingPath = await this.getPath(pathId, mentorId);
      if (!existingPath) {
        throw createError("Learning path not found", 404);
      }

      if (existingPath.mentor_id !== mentorId) {
        throw createError("Access denied", 403);
      }

      if (!existingPath.is_published) {
        throw createError("Learning path is not published", 400);
      }

      // Check for active enrollments
      if (existingPath.enrolled_count > 0) {
        throw createError("Cannot unpublish learning path with active enrollments", 400);
      }

      const unpublishedPath = await LearningPathModel.unpublish(pathId);
      if (!unpublishedPath) {
        throw createError("Failed to unpublish learning path", 500);
      }

      // Invalidate caches
      await Promise.all([
        CacheService.del(CacheKeys.learningPath(pathId)),
        CacheService.del(CacheKeys.mentorPaths(mentorId)),
        CacheService.del(CacheKeys.publishedPaths())
      ]);

      logger.info("Learning path unpublished", { pathId, mentorId });

      return unpublishedPath;
    } catch (error) {
      logger.error("Failed to unpublish learning path", {
        pathId,
        mentorId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Get published learning paths for discovery
   */
  async getPublishedPaths(filters: PathFilters = {}): Promise<{ paths: LearningPathRecord[]; total: number }> {
    try {
      const cacheKey = CacheKeys.publishedPaths();
      
      // Use cache for simple queries
      if (!filters.difficultyLevel && !filters.tags && !filters.mentorId && !filters.page) {
        const cached = await CacheService.get<{ paths: LearningPathRecord[]; total: number }>(cacheKey);
        if (cached) {
          logger.debug("Published paths cache hit");
          return cached;
        }
      }

      const result = await LearningPathModel.findPublished(filters);

      // Cache simple queries
      if (!filters.difficultyLevel && !filters.tags && !filters.mentorId && !filters.page) {
        await CacheService.set(cacheKey, result, CacheTTL.medium);
      }

      return result;
    } catch (error) {
      logger.error("Failed to get published paths", {
        filters,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  }
};