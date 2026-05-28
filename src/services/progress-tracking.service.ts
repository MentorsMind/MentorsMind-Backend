import { EnrollmentModel, MilestoneProgressModel } from "../models/enrollment.model";
import { MilestoneModel } from "../models/milestone.model";
import { LearningPathModel } from "../models/learning-path.model";
import { CacheService } from "./cache.service";
import { CacheKeys, CacheTTL } from "../utils/cache-key.utils";
import { logger } from "../utils/logger.utils";
import { createError } from "../middleware/errorHandler";
import { WebhookService } from "./webhook.service";
import pool from "../config/database";
import { 
  StudentProgress, 
  MilestoneProgress, 
  PathEnrollment,
  Milestone,
  Achievement,
  CompleteMilestoneData
} from "../models/learning-path.model";

export interface ProgressInsight {
  type: 'warning' | 'success' | 'info';
  title: string;
  description: string;
  actionable: boolean;
  metadata: Record<string, any>;
}

export interface PathAnalytics {
  pathId: string;
  totalEnrollments: number;
  activeStudents: number;
  completionRate: number;
  averageCompletionTime: number;
  dropoutRate: number;
  revenueGenerated: number;
  studentSatisfaction: number;
  milestoneAnalytics: MilestoneAnalytics[];
}

export interface MilestoneAnalytics {
  milestoneId: string;
  completionRate: number;
  averageTimeToComplete: number;
  dropoutRate: number;
  difficultyRating: number;
  commonStruggles: string[];
}

export interface MilestoneCompletion {
  milestoneId: string;
  enrollmentId: string;
  completedAt: string;
  certificateGenerated: boolean;
  nextMilestone?: Milestone;
  pathCompleted: boolean;
}

export interface ProgressUpdate {
  enrollmentId: string;
  milestoneId: string;
  progress: number;
  timeSpentMinutes?: number;
  sessionId?: string;
  notes?: string;
}

export interface ProgressSummary {
  totalMilestones: number;
  completedMilestones: number;
  inProgressMilestones: number;
  notStartedMilestones: number;
  overallProgress: number;
  estimatedTimeRemaining: number;
  currentStreak: number;
  lastActivity: string | null;
}

export const ProgressTrackingService = {
  /**
   * Update progress for a specific milestone with enhanced tracking
   */
  async updateProgress(
    enrollmentId: string, 
    milestoneId: string, 
    progress: number,
    timeSpentMinutes?: number
  ): Promise<void> {
    try {
      // Validate enrollment exists
      const enrollment = await EnrollmentModel.findById(enrollmentId);
      if (!enrollment) {
        throw createError("Enrollment not found", 404);
      }

      if (enrollment.status !== 'active') {
        throw createError("Cannot update progress for inactive enrollment", 400);
      }

      // Validate milestone belongs to the learning path
      const milestone = await MilestoneModel.findById(milestoneId);
      if (!milestone || milestone.learning_path_id !== enrollment.learning_path_id) {
        throw createError("Milestone not found in learning path", 404);
      }

      // Update milestone progress
      await MilestoneProgressModel.updateProgress(
        enrollmentId, 
        milestoneId, 
        progress, 
        timeSpentMinutes
      );

      // Recalculate overall progress
      const overallProgress = await MilestoneProgressModel.calculateOverallProgress(enrollmentId);
      
      // Update enrollment progress
      await EnrollmentModel.updateProgress(enrollmentId, overallProgress);

      // Invalidate caches
      await Promise.all([
        CacheService.del(CacheKeys.studentProgress(enrollment.student_id, enrollment.learning_path_id)),
        CacheService.del(CacheKeys.enrollmentProgress(enrollmentId))
      ]);

      logger.info("Progress updated", {
        enrollmentId,
        milestoneId,
        progress,
        overallProgress,
        timeSpentMinutes
      });
    } catch (error) {
      logger.error("Failed to update progress", {
        enrollmentId,
        milestoneId,
        progress,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Complete a milestone
   */
  async completeMilestone(
    enrollmentId: string, 
    milestoneId: string, 
    data: CompleteMilestoneData = {}
  ): Promise<MilestoneCompletion> {
    try {
      // Validate enrollment and milestone
      const enrollment = await EnrollmentModel.findById(enrollmentId);
      if (!enrollment) {
        throw createError("Enrollment not found", 404);
      }

      const milestone = await MilestoneModel.findById(milestoneId);
      if (!milestone || milestone.learning_path_id !== enrollment.learning_path_id) {
        throw createError("Milestone not found in learning path", 404);
      }

      // Check prerequisites are met
      const canProceed = await this.validatePrerequisites(enrollment.student_id, milestoneId);
      if (!canProceed.isValid) {
        throw createError(`Prerequisites not met: ${canProceed.message}`, 400);
      }

      // Complete the milestone
      const completedProgress = await MilestoneProgressModel.completeMilestone(
        enrollmentId, 
        milestoneId, 
        data
      );

      if (!completedProgress) {
        throw createError("Failed to complete milestone", 500);
      }

      // Recalculate overall progress
      const overallProgress = await MilestoneProgressModel.calculateOverallProgress(enrollmentId);
      
      // Get next milestone
      const milestones = await MilestoneModel.findByLearningPathId(enrollment.learning_path_id);
      const currentMilestone = milestones.find(m => m.id === milestoneId);
      const nextMilestone = milestones.find(m => m.order_index === (currentMilestone?.order_index || 0) + 1);

      // Check if path is completed
      const stats = await MilestoneProgressModel.getCompletionStats(enrollmentId);
      const pathCompleted = stats.completedMilestones + stats.skippedMilestones === stats.totalMilestones;

      // Update enrollment
      if (pathCompleted) {
        await EnrollmentModel.updateStatus(enrollmentId, { status: 'completed' });
      } else {
        await EnrollmentModel.updateProgress(
          enrollmentId, 
          overallProgress, 
          nextMilestone?.id
        );
      }

      // Generate achievement
      await this.generateAchievement(enrollment.student_id, 'milestone_completed', {
        milestoneId,
        milestoneTitle: milestone.title,
        pathId: enrollment.learning_path_id
      });

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
        certificateGenerated: false, // TODO: Implement certificate generation
        nextMilestone: nextMilestone ? MilestoneModel.transformToMilestone(nextMilestone) : undefined,
        pathCompleted
      };

      logger.info("Milestone completed", {
        enrollmentId,
        milestoneId,
        pathCompleted,
        overallProgress
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
   * Get detailed student progress
   */
  async getStudentProgress(enrollmentId: string): Promise<StudentProgress> {
    try {
      const cacheKey = CacheKeys.enrollmentProgress(enrollmentId);
      
      // Try cache first
      const cached = await CacheService.get<StudentProgress>(cacheKey);
      if (cached) {
        logger.debug("Student progress cache hit", { enrollmentId });
        return cached;
      }

      // Get enrollment
      const enrollmentRecord = await EnrollmentModel.findById(enrollmentId);
      if (!enrollmentRecord) {
        throw createError("Enrollment not found", 404);
      }

      // Get milestone progress
      const progressRecords = await MilestoneProgressModel.findByEnrollmentId(enrollmentId);
      const milestoneProgress = progressRecords.map(p => MilestoneProgressModel.transformToProgress(p));

      // Get milestones
      const milestones = await MilestoneModel.getMilestonesByPath(enrollmentRecord.learning_path_id);
      
      // Find current and next milestones
      const currentMilestone = milestones.find(m => m.id === enrollmentRecord.current_milestone_id);
      const nextMilestone = currentMilestone 
        ? milestones.find(m => m.orderIndex === currentMilestone.orderIndex + 1)
        : milestones[0];

      // Get completion stats
      const stats = await MilestoneProgressModel.getCompletionStats(enrollmentId);

      // Calculate estimated time remaining
      const completedMilestones = milestoneProgress.filter(p => p.status === 'completed');
      const avgTimePerMilestone = completedMilestones.length > 0
        ? completedMilestones.reduce((sum, p) => sum + p.timeSpentMinutes, 0) / completedMilestones.length
        : 60; // Default 1 hour per milestone

      const remainingMilestones = stats.totalMilestones - stats.completedMilestones - stats.skippedMilestones;
      const estimatedTimeRemaining = Math.round(remainingMilestones * avgTimePerMilestone);

      // Get achievements
      const achievements = await this.getStudentAchievements(enrollmentRecord.student_id, enrollmentRecord.learning_path_id);

      const result: StudentProgress = {
        enrollment: EnrollmentModel.transformToEnrollment(enrollmentRecord),
        milestoneProgress,
        currentMilestone,
        nextMilestone,
        completedMilestones: stats.completedMilestones,
        totalMilestones: stats.totalMilestones,
        estimatedTimeRemaining,
        achievements
      };

      // Cache for 2 minutes
      await CacheService.set(cacheKey, result, CacheTTL.veryShort);

      return result;
    } catch (error) {
      logger.error("Failed to get student progress", {
        enrollmentId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Batch update progress for multiple milestones
   */
  async batchUpdateProgress(updates: ProgressUpdate[]): Promise<void> {
    try {
      const client = await pool.connect();
      
      try {
        await client.query('BEGIN');

        for (const update of updates) {
          await this.updateProgress(
            update.enrollmentId,
            update.milestoneId,
            update.progress,
            update.timeSpentMinutes
          );
        }

        await client.query('COMMIT');

        logger.info("Batch progress update completed", {
          updateCount: updates.length,
          enrollmentIds: [...new Set(updates.map(u => u.enrollmentId))]
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      logger.error("Failed to batch update progress", {
        updateCount: updates.length,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Get progress summary for an enrollment
   */
  async getProgressSummary(enrollmentId: string): Promise<ProgressSummary> {
    try {
      const cacheKey = `${CacheKeys.enrollmentProgress(enrollmentId)}:summary`;
      
      // Try cache first
      const cached = await CacheService.get<ProgressSummary>(cacheKey);
      if (cached) {
        logger.debug("Progress summary cache hit", { enrollmentId });
        return cached;
      }

      // Get completion stats
      const stats = await MilestoneProgressModel.getCompletionStats(enrollmentId);
      const overallProgress = await MilestoneProgressModel.calculateOverallProgress(enrollmentId);

      // Get milestone progress for time calculations
      const progressRecords = await MilestoneProgressModel.findByEnrollmentId(enrollmentId);
      
      // Calculate estimated time remaining
      const completedMilestones = progressRecords.filter(p => p.status === 'completed');
      const avgTimePerMilestone = completedMilestones.length > 0
        ? completedMilestones.reduce((sum, p) => sum + p.time_spent_minutes, 0) / completedMilestones.length
        : 60; // Default 1 hour per milestone

      const remainingMilestones = stats.totalMilestones - stats.completedMilestones - stats.skippedMilestones;
      const estimatedTimeRemaining = Math.round(remainingMilestones * avgTimePerMilestone);

      // Calculate current streak (consecutive days with activity)
      const currentStreak = await this.calculateCurrentStreak(enrollmentId);

      // Get last activity
      const lastActivity = progressRecords
        .filter(p => p.updated_at)
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())[0]?.updated_at || null;

      const summary: ProgressSummary = {
        totalMilestones: stats.totalMilestones,
        completedMilestones: stats.completedMilestones,
        inProgressMilestones: stats.inProgressMilestones,
        notStartedMilestones: stats.notStartedMilestones,
        overallProgress,
        estimatedTimeRemaining,
        currentStreak,
        lastActivity: lastActivity ? new Date(lastActivity).toISOString() : null
      };

      // Cache for 1 minute
      await CacheService.set(cacheKey, summary, CacheTTL.veryShort);

      return summary;
    } catch (error) {
      logger.error("Failed to get progress summary", {
        enrollmentId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Calculate current learning streak
   */
  async calculateCurrentStreak(enrollmentId: string): Promise<number> {
    try {
      // Get progress updates ordered by date
      const { rows } = await pool.query(
        `SELECT DATE(updated_at) as activity_date
         FROM milestone_progress 
         WHERE enrollment_id = $1 AND updated_at >= NOW() - INTERVAL '30 days'
         GROUP BY DATE(updated_at)
         ORDER BY activity_date DESC`,
        [enrollmentId]
      );

      if (rows.length === 0) return 0;

      let streak = 0;
      let currentDate = new Date();
      currentDate.setHours(0, 0, 0, 0);

      for (const row of rows) {
        const activityDate = new Date(row.activity_date);
        activityDate.setHours(0, 0, 0, 0);

        const daysDiff = Math.floor((currentDate.getTime() - activityDate.getTime()) / (1000 * 60 * 60 * 24));

        if (daysDiff === streak) {
          streak++;
          currentDate = new Date(activityDate);
        } else if (daysDiff === streak + 1) {
          // Allow for one day gap (yesterday)
          streak++;
          currentDate = new Date(activityDate);
        } else {
          break;
        }
      }

      return streak;
    } catch (error) {
      logger.error("Failed to calculate current streak", {
        enrollmentId,
        error: error instanceof Error ? error.message : error
      });
      return 0;
    }
  },

  /**
   * Get learning velocity (milestones completed per week)
   */
  async getLearningVelocity(enrollmentId: string, weeks: number = 4): Promise<number> {
    try {
      const { rows } = await pool.query(
        `SELECT COUNT(*) as completed_count
         FROM milestone_progress 
         WHERE enrollment_id = $1 
         AND status = 'completed' 
         AND completed_at >= NOW() - INTERVAL '${weeks} weeks'`,
        [enrollmentId]
      );

      const completedCount = parseInt(rows[0].completed_count, 10);
      return completedCount / weeks;
    } catch (error) {
      logger.error("Failed to get learning velocity", {
        enrollmentId,
        weeks,
        error: error instanceof Error ? error.message : error
      });
      return 0;
    }
  },

  /**
   * Predict completion date based on current progress
   */
  async predictCompletionDate(enrollmentId: string): Promise<Date | null> {
    try {
      const summary = await this.getProgressSummary(enrollmentId);
      const velocity = await this.getLearningVelocity(enrollmentId);

      if (velocity === 0 || summary.totalMilestones === summary.completedMilestones) {
        return null;
      }

      const remainingMilestones = summary.totalMilestones - summary.completedMilestones;
      const weeksToComplete = remainingMilestones / velocity;
      
      const completionDate = new Date();
      completionDate.setDate(completionDate.getDate() + (weeksToComplete * 7));

      return completionDate;
    } catch (error) {
      logger.error("Failed to predict completion date", {
        enrollmentId,
        error: error instanceof Error ? error.message : error
      });
      return null;
    }
  },
  async getPathAnalytics(pathId: string): Promise<PathAnalytics> {
    try {
      const cacheKey = CacheKeys.pathAnalytics(pathId);
      
      // Try cache first
      const cached = await CacheService.get<PathAnalytics>(cacheKey);
      if (cached) {
        logger.debug("Path analytics cache hit", { pathId });
        return cached;
      }

      // Get basic path stats
      const learningPath = await LearningPathModel.findById(pathId);
      if (!learningPath) {
        throw createError("Learning path not found", 404);
      }

      // Get enrollment analytics
      const { enrollments } = await EnrollmentModel.findByLearningPathId(pathId, { limit: 1000 });
      
      const totalEnrollments = enrollments.length;
      const activeStudents = enrollments.filter(e => e.status === 'active').length;
      const completedEnrollments = enrollments.filter(e => e.status === 'completed').length;
      const completionRate = totalEnrollments > 0 ? (completedEnrollments / totalEnrollments) * 100 : 0;

      // Calculate average completion time
      const completedWithTime = enrollments.filter(e => 
        e.status === 'completed' && e.enrolled_at && e.completed_at
      );
      
      const avgCompletionTime = completedWithTime.length > 0
        ? completedWithTime.reduce((sum, e) => {
            const enrolledAt = new Date(e.enrolled_at);
            const completedAt = new Date(e.completed_at!);
            return sum + (completedAt.getTime() - enrolledAt.getTime());
          }, 0) / completedWithTime.length / (1000 * 60 * 60 * 24) // Convert to days
        : 0;

      // Calculate dropout rate
      const cancelledEnrollments = enrollments.filter(e => e.status === 'cancelled').length;
      const dropoutRate = totalEnrollments > 0 ? (cancelledEnrollments / totalEnrollments) * 100 : 0;

      // Calculate revenue (placeholder - would integrate with payment system)
      const revenueGenerated = enrollments.reduce((sum, e) => sum + e.total_paid, 0);

      // Get milestone analytics
      const milestones = await MilestoneModel.findByLearningPathId(pathId);
      const milestoneAnalytics: MilestoneAnalytics[] = [];

      for (const milestone of milestones) {
        // Get progress for this milestone across all enrollments
        const milestoneStats = await this.getMilestoneAnalytics(milestone.id);
        milestoneAnalytics.push(milestoneStats);
      }

      const result: PathAnalytics = {
        pathId,
        totalEnrollments,
        activeStudents,
        completionRate,
        averageCompletionTime: avgCompletionTime,
        dropoutRate,
        revenueGenerated,
        studentSatisfaction: learningPath.rating,
        milestoneAnalytics
      };

      // Cache for 10 minutes
      await CacheService.set(cacheKey, result, CacheTTL.medium);

      return result;
    } catch (error) {
      logger.error("Failed to get path analytics", {
        pathId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Calculate completion rate for a learning path
   */
  async calculateCompletionRate(pathId: string): Promise<number> {
    try {
      const { enrollments } = await EnrollmentModel.findByLearningPathId(pathId, { limit: 1000 });
      
      if (enrollments.length === 0) return 0;
      
      const completedCount = enrollments.filter(e => e.status === 'completed').length;
      return (completedCount / enrollments.length) * 100;
    } catch (error) {
      logger.error("Failed to calculate completion rate", {
        pathId,
        error: error instanceof Error ? error.message : error
      });
      return 0;
    }
  },

  /**
   * Get progress insights for a student
   */
  async getProgressInsights(enrollmentId: string): Promise<ProgressInsight[]> {
    try {
      const insights: ProgressInsight[] = [];
      
      const progress = await this.getStudentProgress(enrollmentId);
      const enrollment = progress.enrollment;

      // Check for stalled progress
      const lastActivity = progress.milestoneProgress
        .filter(p => p.updatedAt)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];

      if (lastActivity) {
        const daysSinceActivity = (Date.now() - new Date(lastActivity.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
        
        if (daysSinceActivity > 7) {
          insights.push({
            type: 'warning',
            title: 'Stalled Progress',
            description: `No activity for ${Math.round(daysSinceActivity)} days. Consider reaching out to your mentor.`,
            actionable: true,
            metadata: { daysSinceActivity, lastActivity: lastActivity.updatedAt }
          });
        }
      }

      // Check for fast progress
      const completedMilestones = progress.milestoneProgress.filter(p => p.status === 'completed');
      if (completedMilestones.length >= 2) {
        const avgDaysPerMilestone = completedMilestones.reduce((sum, p) => {
          if (p.startedAt && p.completedAt) {
            const days = (new Date(p.completedAt).getTime() - new Date(p.startedAt).getTime()) / (1000 * 60 * 60 * 24);
            return sum + days;
          }
          return sum;
        }, 0) / completedMilestones.length;

        if (avgDaysPerMilestone < 2) {
          insights.push({
            type: 'success',
            title: 'Fast Learner',
            description: 'You\'re making excellent progress! Keep up the great work.',
            actionable: false,
            metadata: { avgDaysPerMilestone }
          });
        }
      }

      // Check for completion milestone
      const completionPercentage = (progress.completedMilestones / progress.totalMilestones) * 100;
      if (completionPercentage >= 75 && enrollment.status === 'active') {
        insights.push({
          type: 'info',
          title: 'Almost There!',
          description: `You're ${Math.round(completionPercentage)}% complete. Just ${progress.totalMilestones - progress.completedMilestones} milestones to go!`,
          actionable: false,
          metadata: { completionPercentage }
        });
      }

      return insights;
    } catch (error) {
      logger.error("Failed to get progress insights", {
        enrollmentId,
        error: error instanceof Error ? error.message : error
      });
      return [];
    }
  },

  /**
   * Validate prerequisites for a milestone
   */
  async validatePrerequisites(studentId: string, milestoneId: string): Promise<{ isValid: boolean; message: string }> {
    try {
      // Get milestone with prerequisites
      const milestoneWithPrereqs = await MilestoneModel.findWithPrerequisites(milestoneId);
      if (!milestoneWithPrereqs) {
        return { isValid: false, message: "Milestone not found" };
      }

      if (!milestoneWithPrereqs.prerequisites || milestoneWithPrereqs.prerequisites.length === 0) {
        return { isValid: true, message: "No prerequisites required" };
      }

      // Get student's enrollment for this path
      const enrollment = await EnrollmentModel.findByStudentAndPath(studentId, milestoneWithPrereqs.learning_path_id);
      if (!enrollment) {
        return { isValid: false, message: "Student not enrolled in this learning path" };
      }

      // Check each prerequisite
      for (const prereq of milestoneWithPrereqs.prerequisites) {
        if (!prereq.is_required) continue;

        if (prereq.prerequisite_type === 'milestone' && prereq.prerequisite_id) {
          // Check if prerequisite milestone is completed
          const prereqProgress = await MilestoneProgressModel.findByEnrollmentAndMilestone(
            enrollment.id, 
            prereq.prerequisite_id
          );
          
          if (!prereqProgress || prereqProgress.status !== 'completed') {
            return { 
              isValid: false, 
              message: `Prerequisite milestone must be completed first` 
            };
          }
        }
        
        // TODO: Implement skill and assessment prerequisite validation
      }

      return { isValid: true, message: "All prerequisites met" };
    } catch (error) {
      logger.error("Failed to validate prerequisites", {
        studentId,
        milestoneId,
        error: error instanceof Error ? error.message : error
      });
      return { isValid: false, message: "Error validating prerequisites" };
    }
  },

  /**
   * Generate achievement for student
   */
  async generateAchievement(
    studentId: string, 
    type: Achievement['type'], 
    metadata: Record<string, any>
  ): Promise<void> {
    try {
      // TODO: Implement achievement system
      // This would create achievement records and potentially trigger notifications
      
      logger.info("Achievement generated", {
        studentId,
        type,
        metadata
      });
    } catch (error) {
      logger.error("Failed to generate achievement", {
        studentId,
        type,
        error: error instanceof Error ? error.message : error
      });
    }
  },

  /**
   * Get student achievements for a learning path
   */
  async getStudentAchievements(studentId: string, pathId: string): Promise<Achievement[]> {
    try {
      // TODO: Implement achievement retrieval
      // This would fetch achievement records from database
      
      return [];
    } catch (error) {
      logger.error("Failed to get student achievements", {
        studentId,
        pathId,
        error: error instanceof Error ? error.message : error
      });
      return [];
    }
  },

  /**
   * Get analytics for a specific milestone
   */
  async getMilestoneAnalytics(milestoneId: string): Promise<MilestoneAnalytics> {
    try {
      // TODO: Implement detailed milestone analytics
      // This would analyze completion rates, time to complete, common issues, etc.
      
      return {
        milestoneId,
        completionRate: 0,
        averageTimeToComplete: 0,
        dropoutRate: 0,
        difficultyRating: 0,
        commonStruggles: []
      };
    } catch (error) {
      logger.error("Failed to get milestone analytics", {
        milestoneId,
        error: error instanceof Error ? error.message : error
      });
      
      return {
        milestoneId,
        completionRate: 0,
        averageTimeToComplete: 0,
        dropoutRate: 0,
        difficultyRating: 0,
        commonStruggles: []
      };
    }
  }
};