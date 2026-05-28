import { MilestoneProgressModel, EnrollmentModel } from "../models/enrollment.model";
import { MilestoneModel } from "../models/milestone.model";
import { LearningPathModel } from "../models/learning-path.model";
import { ProgressTrackingService } from "./progress-tracking.service";
import { CacheService } from "./cache.service";
import { CacheKeys } from "../utils/cache-key.utils";
import { logger } from "../utils/logger.utils";
import { createError } from "../middleware/errorHandler";
import { 
  CompleteMilestoneData,
  MilestoneCompletion,
  Milestone,
  CompletionCriteria
} from "../models/learning-path.model";
import pool from "../config/database";

export interface CompletionValidation {
  isValid: boolean;
  missingRequirements: string[];
  canOverride: boolean;
  message: string;
}

export interface AutoCompletionRule {
  type: 'session_count' | 'time_spent' | 'assessment_score' | 'project_submission';
  threshold: number;
  description: string;
}

export const MilestoneCompletionService = {
  /**
   * Complete a milestone with comprehensive validation
   */
  async completeMilestone(
    enrollmentId: string,
    milestoneId: string,
    completionData: CompleteMilestoneData,
    mentorOverride: boolean = false
  ): Promise<MilestoneCompletion> {
    try {
      // Validate enrollment and milestone
      const enrollment = await EnrollmentModel.findById(enrollmentId);
      if (!enrollment) {
        throw createError("Enrollment not found", 404);
      }

      if (enrollment.status !== 'active') {
        throw createError("Cannot complete milestone for inactive enrollment", 400);
      }

      const milestone = await MilestoneModel.findById(milestoneId);
      if (!milestone || milestone.learning_path_id !== enrollment.learning_path_id) {
        throw createError("Milestone not found in learning path", 404);
      }

      // Check if already completed
      const existingProgress = await MilestoneProgressModel.findByEnrollmentAndMilestone(
        enrollmentId, 
        milestoneId
      );

      if (existingProgress?.status === 'completed') {
        throw createError("Milestone is already completed", 400);
      }

      // Validate completion criteria unless mentor override
      if (!mentorOverride) {
        const validation = await this.validateCompletionCriteria(
          enrollmentId, 
          milestoneId, 
          completionData
        );

        if (!validation.isValid) {
          throw createError(`Completion criteria not met: ${validation.message}`, 400);
        }
      }

      // Check prerequisites
      const prerequisiteValidation = await ProgressTrackingService.validatePrerequisites(
        enrollment.student_id, 
        milestoneId
      );

      if (!prerequisiteValidation.isValid && !mentorOverride) {
        throw createError(`Prerequisites not met: ${prerequisiteValidation.message}`, 400);
      }

      // Complete the milestone
      const completedProgress = await MilestoneProgressModel.completeMilestone(
        enrollmentId,
        milestoneId,
        completionData
      );

      if (!completedProgress) {
        throw createError("Failed to complete milestone", 500);
      }

      // Update overall enrollment progress
      const overallProgress = await MilestoneProgressModel.calculateOverallProgress(enrollmentId);
      
      // Get next milestone
      const milestones = await MilestoneModel.findByLearningPathId(enrollment.learning_path_id);
      const currentMilestone = milestones.find(m => m.id === milestoneId);
      const nextMilestone = milestones.find(m => m.order_index === (currentMilestone?.order_index || 0) + 1);

      // Check if path is completed
      const stats = await MilestoneProgressModel.getCompletionStats(enrollmentId);
      const pathCompleted = stats.completedMilestones + stats.skippedMilestones === stats.totalMilestones;

      // Update enrollment status if path completed
      if (pathCompleted) {
        await EnrollmentModel.updateStatus(enrollmentId, { status: 'completed' });
      } else if (nextMilestone) {
        await EnrollmentModel.updateProgress(enrollmentId, overallProgress, nextMilestone.id);
      }

      // Generate completion certificate if configured
      const certificateGenerated = await this.generateCompletionCertificate(
        enrollmentId,
        milestoneId,
        pathCompleted
      );

      // Generate achievement
      await ProgressTrackingService.generateAchievement(
        enrollment.student_id,
        'milestone_completed',
        {
          milestoneId,
          milestoneTitle: milestone.title,
          pathId: enrollment.learning_path_id,
          completionTime: completedProgress.completed_at,
          mentorOverride
        }
      );

      // Invalidate caches
      await Promise.all([
        CacheService.del(CacheKeys.studentProgress(enrollment.student_id, enrollment.learning_path_id)),
        CacheService.del(CacheKeys.enrollmentProgress(enrollmentId)),
        CacheService.del(CacheKeys.pathAnalytics(enrollment.learning_path_id))
      ]);

      const result: MilestoneCompletion = {
        milestoneId,
        enrollmentId,
        completedAt: completedProgress.completed_at!,
        certificateGenerated,
        nextMilestone: nextMilestone ? MilestoneModel.transformToMilestone(nextMilestone) : undefined,
        pathCompleted
      };

      logger.info("Milestone completed", {
        enrollmentId,
        milestoneId,
        studentId: enrollment.student_id,
        pathCompleted,
        overallProgress,
        mentorOverride
      });

      return result;
    } catch (error) {
      logger.error("Failed to complete milestone", {
        enrollmentId,
        milestoneId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Validate completion criteria for a milestone
   */
  async validateCompletionCriteria(
    enrollmentId: string,
    milestoneId: string,
    completionData: CompleteMilestoneData
  ): Promise<CompletionValidation> {
    try {
      const milestone = await MilestoneModel.findById(milestoneId);
      if (!milestone) {
        return {
          isValid: false,
          missingRequirements: ['Milestone not found'],
          canOverride: false,
          message: 'Milestone not found'
        };
      }

      const criteria = milestone.completion_criteria as CompletionCriteria;
      const missingRequirements: string[] = [];

      switch (criteria.type) {
        case 'automatic':
          // Check automatic completion rules
          const autoValidation = await this.validateAutomaticCompletion(enrollmentId, milestoneId);
          if (!autoValidation.isValid) {
            missingRequirements.push(...autoValidation.missingRequirements);
          }
          break;

        case 'manual':
          // Manual completion - always valid if mentor approves
          break;

        case 'assessment':
          // Check assessment score
          if (criteria.requirements.assessmentScore) {
            const score = completionData.completionData?.assessmentScore;
            if (!score || score < criteria.requirements.assessmentScore) {
              missingRequirements.push(
                `Assessment score must be at least ${criteria.requirements.assessmentScore}%`
              );
            }
          }
          break;

        case 'project':
          // Check project submission
          if (criteria.requirements.projectSubmission) {
            const hasSubmission = completionData.completionData?.projectSubmitted;
            if (!hasSubmission) {
              missingRequirements.push('Project submission is required');
            }
          }
          break;
      }

      // Check mentor approval requirement
      if (criteria.requirements.mentorApproval) {
        const hasApproval = completionData.completionData?.mentorApproved;
        if (!hasApproval) {
          missingRequirements.push('Mentor approval is required');
        }
      }

      return {
        isValid: missingRequirements.length === 0,
        missingRequirements,
        canOverride: true, // Mentors can always override
        message: missingRequirements.join(', ')
      };
    } catch (error) {
      logger.error("Failed to validate completion criteria", {
        enrollmentId,
        milestoneId,
        error: error instanceof Error ? error.message : error
      });
      
      return {
        isValid: false,
        missingRequirements: ['Error validating completion criteria'],
        canOverride: true,
        message: 'Error validating completion criteria'
      };
    }
  },

  /**
   * Validate automatic completion rules
   */
  async validateAutomaticCompletion(
    enrollmentId: string,
    milestoneId: string
  ): Promise<CompletionValidation> {
    try {
      const milestone = await MilestoneModel.findById(milestoneId);
      if (!milestone) {
        return {
          isValid: false,
          missingRequirements: ['Milestone not found'],
          canOverride: false,
          message: 'Milestone not found'
        };
      }

      const criteria = milestone.completion_criteria as CompletionCriteria;
      const missingRequirements: string[] = [];

      // Check session requirements
      if (criteria.requirements.sessionsRequired) {
        const sessionCount = await this.getCompletedSessionCount(enrollmentId, milestoneId);
        if (sessionCount < criteria.requirements.sessionsRequired) {
          missingRequirements.push(
            `${criteria.requirements.sessionsRequired - sessionCount} more sessions required`
          );
        }
      }

      return {
        isValid: missingRequirements.length === 0,
        missingRequirements,
        canOverride: true,
        message: missingRequirements.join(', ')
      };
    } catch (error) {
      logger.error("Failed to validate automatic completion", {
        enrollmentId,
        milestoneId,
        error: error instanceof Error ? error.message : error
      });
      
      return {
        isValid: false,
        missingRequirements: ['Error validating automatic completion'],
        canOverride: true,
        message: 'Error validating automatic completion'
      };
    }
  },

  /**
   * Get completed session count for a milestone
   */
  async getCompletedSessionCount(enrollmentId: string, milestoneId: string): Promise<number> {
    try {
      const { rows } = await pool.query(
        `SELECT COUNT(*) as session_count
         FROM milestone_sessions ms
         JOIN bookings b ON ms.booking_id = b.id
         JOIN path_enrollments pe ON pe.student_id = b.mentee_id
         WHERE ms.milestone_id = $1 
         AND pe.id = $2 
         AND b.status = 'completed'
         AND ms.contributes_to_completion = true`,
        [milestoneId, enrollmentId]
      );

      return parseInt(rows[0].session_count, 10);
    } catch (error) {
      logger.error("Failed to get completed session count", {
        enrollmentId,
        milestoneId,
        error: error instanceof Error ? error.message : error
      });
      return 0;
    }
  },

  /**
   * Skip a milestone with reason
   */
  async skipMilestone(
    enrollmentId: string,
    milestoneId: string,
    reason: string,
    mentorId?: string
  ): Promise<void> {
    try {
      // Validate enrollment
      const enrollment = await EnrollmentModel.findById(enrollmentId);
      if (!enrollment) {
        throw createError("Enrollment not found", 404);
      }

      // Validate milestone
      const milestone = await MilestoneModel.findById(milestoneId);
      if (!milestone || milestone.learning_path_id !== enrollment.learning_path_id) {
        throw createError("Milestone not found in learning path", 404);
      }

      // Check if milestone is required (only mentors can skip required milestones)
      if (milestone.is_required && !mentorId) {
        throw createError("Cannot skip required milestone without mentor approval", 403);
      }

      // Skip the milestone
      await MilestoneProgressModel.skipMilestone(enrollmentId, milestoneId, reason);

      // Update overall progress
      const overallProgress = await MilestoneProgressModel.calculateOverallProgress(enrollmentId);
      await EnrollmentModel.updateProgress(enrollmentId, overallProgress);

      // Invalidate caches
      await Promise.all([
        CacheService.del(CacheKeys.studentProgress(enrollment.student_id, enrollment.learning_path_id)),
        CacheService.del(CacheKeys.enrollmentProgress(enrollmentId))
      ]);

      logger.info("Milestone skipped", {
        enrollmentId,
        milestoneId,
        reason,
        mentorId,
        isRequired: milestone.is_required
      });
    } catch (error) {
      logger.error("Failed to skip milestone", {
        enrollmentId,
        milestoneId,
        reason,
        mentorId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Reset milestone progress
   */
  async resetMilestoneProgress(
    enrollmentId: string,
    milestoneId: string,
    mentorId: string
  ): Promise<void> {
    try {
      // Validate mentor has access
      const enrollment = await EnrollmentModel.findById(enrollmentId);
      if (!enrollment) {
        throw createError("Enrollment not found", 404);
      }

      const learningPath = await LearningPathModel.findById(enrollment.learning_path_id);
      if (!learningPath || learningPath.mentor_id !== mentorId) {
        throw createError("Access denied", 403);
      }

      // Reset progress to 0
      await MilestoneProgressModel.updateProgress(enrollmentId, milestoneId, 0);

      // Update overall progress
      const overallProgress = await MilestoneProgressModel.calculateOverallProgress(enrollmentId);
      await EnrollmentModel.updateProgress(enrollmentId, overallProgress);

      // Invalidate caches
      await Promise.all([
        CacheService.del(CacheKeys.studentProgress(enrollment.student_id, enrollment.learning_path_id)),
        CacheService.del(CacheKeys.enrollmentProgress(enrollmentId))
      ]);

      logger.info("Milestone progress reset", {
        enrollmentId,
        milestoneId,
        mentorId
      });
    } catch (error) {
      logger.error("Failed to reset milestone progress", {
        enrollmentId,
        milestoneId,
        mentorId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Generate completion certificate (placeholder for future implementation)
   */
  async generateCompletionCertificate(
    enrollmentId: string,
    milestoneId: string,
    isPathCompletion: boolean = false
  ): Promise<boolean> {
    try {
      // TODO: Implement certificate generation
      // This would integrate with a certificate generation service
      
      logger.info("Certificate generation requested", {
        enrollmentId,
        milestoneId,
        isPathCompletion
      });

      return false; // Not implemented yet
    } catch (error) {
      logger.error("Failed to generate completion certificate", {
        enrollmentId,
        milestoneId,
        isPathCompletion,
        error: error instanceof Error ? error.message : error
      });
      return false;
    }
  },

  /**
   * Get milestone completion statistics for a learning path
   */
  async getMilestoneCompletionStats(pathId: string): Promise<{
    milestoneId: string;
    title: string;
    completionRate: number;
    averageTimeToComplete: number;
    totalAttempts: number;
    successfulCompletions: number;
  }[]> {
    try {
      const { rows } = await pool.query(
        `SELECT 
          m.id as milestone_id,
          m.title,
          COUNT(mp.id) as total_attempts,
          COUNT(CASE WHEN mp.status = 'completed' THEN 1 END) as successful_completions,
          COALESCE(AVG(CASE WHEN mp.status = 'completed' AND mp.started_at IS NOT NULL AND mp.completed_at IS NOT NULL 
                           THEN EXTRACT(EPOCH FROM (mp.completed_at - mp.started_at)) / 3600 END), 0) as avg_hours_to_complete
         FROM milestones m
         LEFT JOIN milestone_progress mp ON m.id = mp.milestone_id
         WHERE m.learning_path_id = $1
         GROUP BY m.id, m.title, m.order_index
         ORDER BY m.order_index`,
        [pathId]
      );

      return rows.map(row => ({
        milestoneId: row.milestone_id,
        title: row.title,
        completionRate: row.total_attempts > 0 
          ? (row.successful_completions / row.total_attempts) * 100 
          : 0,
        averageTimeToComplete: parseFloat(row.avg_hours_to_complete),
        totalAttempts: parseInt(row.total_attempts, 10),
        successfulCompletions: parseInt(row.successful_completions, 10)
      }));
    } catch (error) {
      logger.error("Failed to get milestone completion stats", {
        pathId,
        error: error instanceof Error ? error.message : error
      });
      return [];
    }
  }
};