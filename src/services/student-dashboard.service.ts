import { EnrollmentModel, MilestoneProgressModel } from "../models/enrollment.model";
import { LearningPathModel } from "../models/learning-path.model";
import { MilestoneModel } from "../models/milestone.model";
import { ProgressTrackingService } from "./progress-tracking.service";
import { CacheService } from "./cache.service";
import { CacheKeys, CacheTTL } from "../utils/cache-key.utils";
import { logger } from "../utils/logger.utils";
import { createError } from "../middleware/errorHandler";
import { 
  StudentProgress, 
  Achievement, 
  PathEnrollment,
  Milestone
} from "../models/learning-path.model";
import pool from "../config/database";

export interface StudentDashboardData {
  overview: StudentOverview;
  activeEnrollments: EnrollmentWithProgress[];
  recentActivity: ActivityItem[];
  upcomingMilestones: UpcomingMilestone[];
  achievements: Achievement[];
  learningStreak: StreakInfo;
  recommendations: LearningRecommendation[];
}

export interface StudentOverview {
  totalEnrollments: number;
  activeEnrollments: number;
  completedPaths: number;
  totalMilestonesCompleted: number;
  totalTimeSpent: number; // in minutes
  averageProgress: number;
  currentStreak: number;
  longestStreak: number;
}

export interface EnrollmentWithProgress {
  enrollment: PathEnrollment;
  learningPath: {
    id: string;
    title: string;
    mentorName: string;
    difficultyLevel: string;
    estimatedDurationHours: number;
  };
  progress: {
    percentage: number;
    completedMilestones: number;
    totalMilestones: number;
    currentMilestone?: Milestone;
    nextMilestone?: Milestone;
    estimatedTimeRemaining: number;
  };
  lastActivity?: string;
}

export interface ActivityItem {
  id: string;
  type: 'milestone_completed' | 'milestone_started' | 'path_enrolled' | 'path_completed' | 'achievement_earned';
  title: string;
  description: string;
  timestamp: string;
  pathId?: string;
  pathTitle?: string;
  milestoneId?: string;
  milestoneTitle?: string;
  metadata?: Record<string, any>;
}

export interface UpcomingMilestone {
  milestoneId: string;
  title: string;
  description?: string;
  pathId: string;
  pathTitle: string;
  estimatedDuration: number;
  dueDate?: string;
  priority: 'high' | 'medium' | 'low';
  prerequisitesMet: boolean;
}

export interface StreakInfo {
  current: number;
  longest: number;
  lastActivityDate?: string;
  streakStartDate?: string;
  daysUntilBreak: number;
}

export interface LearningRecommendation {
  type: 'continue_path' | 'new_path' | 'skill_gap' | 'mentor_session';
  title: string;
  description: string;
  actionUrl?: string;
  priority: number;
  pathId?: string;
  mentorId?: string;
}

export const StudentDashboardService = {
  /**
   * Get comprehensive dashboard data for a student
   */
  async getDashboardData(studentId: string): Promise<StudentDashboardData> {
    try {
      const cacheKey = `student:dashboard:${studentId}`;
      
      // Try cache first
      const cached = await CacheService.get<StudentDashboardData>(cacheKey);
      if (cached) {
        logger.debug("Student dashboard cache hit", { studentId });
        return cached;
      }

      // Get all components in parallel for better performance
      const [
        overview,
        activeEnrollments,
        recentActivity,
        upcomingMilestones,
        achievements,
        learningStreak,
        recommendations
      ] = await Promise.all([
        this.getStudentOverview(studentId),
        this.getActiveEnrollmentsWithProgress(studentId),
        this.getRecentActivity(studentId),
        this.getUpcomingMilestones(studentId),
        this.getStudentAchievements(studentId),
        this.getLearningStreak(studentId),
        this.getLearningRecommendations(studentId)
      ]);

      const dashboardData: StudentDashboardData = {
        overview,
        activeEnrollments,
        recentActivity,
        upcomingMilestones,
        achievements,
        learningStreak,
        recommendations
      };

      // Cache for 2 minutes
      await CacheService.set(cacheKey, dashboardData, CacheTTL.veryShort);

      return dashboardData;
    } catch (error) {
      logger.error("Failed to get student dashboard data", {
        studentId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Get student overview statistics
   */
  async getStudentOverview(studentId: string): Promise<StudentOverview> {
    try {
      // Get enrollment statistics
      const { rows: enrollmentStats } = await pool.query(
        `SELECT 
          COUNT(*) as total_enrollments,
          COUNT(CASE WHEN status = 'active' THEN 1 END) as active_enrollments,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_paths,
          COALESCE(AVG(progress_percentage), 0) as average_progress
         FROM path_enrollments 
         WHERE student_id = $1`,
        [studentId]
      );

      // Get milestone statistics
      const { rows: milestoneStats } = await pool.query(
        `SELECT 
          COUNT(CASE WHEN mp.status = 'completed' THEN 1 END) as completed_milestones,
          COALESCE(SUM(mp.time_spent_minutes), 0) as total_time_spent
         FROM path_enrollments pe
         JOIN milestone_progress mp ON pe.id = mp.enrollment_id
         WHERE pe.student_id = $1`,
        [studentId]
      );

      // Get streak information
      const currentStreak = await this.calculateCurrentStreak(studentId);
      const longestStreak = await this.calculateLongestStreak(studentId);

      const stats = enrollmentStats[0];
      const milestones = milestoneStats[0];

      return {
        totalEnrollments: parseInt(stats.total_enrollments, 10),
        activeEnrollments: parseInt(stats.active_enrollments, 10),
        completedPaths: parseInt(stats.completed_paths, 10),
        totalMilestonesCompleted: parseInt(milestones.completed_milestones, 10),
        totalTimeSpent: parseInt(milestones.total_time_spent, 10),
        averageProgress: parseFloat(stats.average_progress),
        currentStreak,
        longestStreak
      };
    } catch (error) {
      logger.error("Failed to get student overview", {
        studentId,
        error: error instanceof Error ? error.message : error
      });
      
      // Return default values on error
      return {
        totalEnrollments: 0,
        activeEnrollments: 0,
        completedPaths: 0,
        totalMilestonesCompleted: 0,
        totalTimeSpent: 0,
        averageProgress: 0,
        currentStreak: 0,
        longestStreak: 0
      };
    }
  },

  /**
   * Get active enrollments with progress details
   */
  async getActiveEnrollmentsWithProgress(studentId: string): Promise<EnrollmentWithProgress[]> {
    try {
      const { enrollments } = await EnrollmentModel.findByStudentId(studentId, { 
        status: 'active',
        limit: 10 
      });

      const enrollmentsWithProgress: EnrollmentWithProgress[] = [];

      for (const enrollmentRecord of enrollments) {
        // Get learning path details
        const learningPath = await LearningPathModel.findById(enrollmentRecord.learning_path_id);
        if (!learningPath) continue;

        // Get mentor name
        const { rows: mentorRows } = await pool.query(
          `SELECT first_name, last_name FROM users WHERE id = $1`,
          [learningPath.mentor_id]
        );
        const mentor = mentorRows[0];
        const mentorName = mentor ? `${mentor.first_name} ${mentor.last_name}` : 'Unknown';

        // Get progress details
        const studentProgress = await ProgressTrackingService.getStudentProgress(enrollmentRecord.id);
        
        // Get last activity
        const lastActivity = studentProgress.milestoneProgress
          .filter(p => p.updatedAt)
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0]?.updatedAt;

        enrollmentsWithProgress.push({
          enrollment: EnrollmentModel.transformToEnrollment(enrollmentRecord),
          learningPath: {
            id: learningPath.id,
            title: learningPath.title,
            mentorName,
            difficultyLevel: learningPath.difficulty_level,
            estimatedDurationHours: learningPath.estimated_duration_hours
          },
          progress: {
            percentage: studentProgress.enrollment.progressPercentage,
            completedMilestones: studentProgress.completedMilestones,
            totalMilestones: studentProgress.totalMilestones,
            currentMilestone: studentProgress.currentMilestone,
            nextMilestone: studentProgress.nextMilestone,
            estimatedTimeRemaining: studentProgress.estimatedTimeRemaining
          },
          lastActivity
        });
      }

      return enrollmentsWithProgress;
    } catch (error) {
      logger.error("Failed to get active enrollments with progress", {
        studentId,
        error: error instanceof Error ? error.message : error
      });
      return [];
    }
  },

  /**
   * Get recent activity for the student
   */
  async getRecentActivity(studentId: string, limit: number = 10): Promise<ActivityItem[]> {
    try {
      const activities: ActivityItem[] = [];

      // Get recent milestone completions
      const { rows: milestoneCompletions } = await pool.query(
        `SELECT 
          mp.id,
          mp.milestone_id,
          mp.completed_at,
          m.title as milestone_title,
          lp.id as path_id,
          lp.title as path_title
         FROM milestone_progress mp
         JOIN milestones m ON mp.milestone_id = m.id
         JOIN learning_paths lp ON m.learning_path_id = lp.id
         JOIN path_enrollments pe ON mp.enrollment_id = pe.id
         WHERE pe.student_id = $1 
         AND mp.status = 'completed'
         AND mp.completed_at >= NOW() - INTERVAL '30 days'
         ORDER BY mp.completed_at DESC
         LIMIT $2`,
        [studentId, limit]
      );

      milestoneCompletions.forEach(row => {
        activities.push({
          id: `milestone_${row.id}`,
          type: 'milestone_completed',
          title: 'Milestone Completed',
          description: `Completed "${row.milestone_title}" in ${row.path_title}`,
          timestamp: new Date(row.completed_at).toISOString(),
          pathId: row.path_id,
          pathTitle: row.path_title,
          milestoneId: row.milestone_id,
          milestoneTitle: row.milestone_title
        });
      });

      // Get recent enrollments
      const { rows: recentEnrollments } = await pool.query(
        `SELECT 
          pe.id,
          pe.enrolled_at,
          lp.id as path_id,
          lp.title as path_title
         FROM path_enrollments pe
         JOIN learning_paths lp ON pe.learning_path_id = lp.id
         WHERE pe.student_id = $1 
         AND pe.enrolled_at >= NOW() - INTERVAL '30 days'
         ORDER BY pe.enrolled_at DESC
         LIMIT $2`,
        [studentId, limit]
      );

      recentEnrollments.forEach(row => {
        activities.push({
          id: `enrollment_${row.id}`,
          type: 'path_enrolled',
          title: 'Enrolled in Learning Path',
          description: `Started learning "${row.path_title}"`,
          timestamp: new Date(row.enrolled_at).toISOString(),
          pathId: row.path_id,
          pathTitle: row.path_title
        });
      });

      // Sort all activities by timestamp and limit
      return activities
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, limit);
    } catch (error) {
      logger.error("Failed to get recent activity", {
        studentId,
        limit,
        error: error instanceof Error ? error.message : error
      });
      return [];
    }
  },

  /**
   * Get upcoming milestones for the student
   */
  async getUpcomingMilestones(studentId: string, limit: number = 5): Promise<UpcomingMilestone[]> {
    try {
      const { rows } = await pool.query(
        `SELECT 
          m.id as milestone_id,
          m.title,
          m.description,
          m.estimated_duration_hours,
          m.order_index,
          lp.id as path_id,
          lp.title as path_title,
          pe.current_milestone_id,
          COALESCE(mp.status, 'not_started') as status
         FROM path_enrollments pe
         JOIN learning_paths lp ON pe.learning_path_id = lp.id
         JOIN milestones m ON lp.id = m.learning_path_id
         LEFT JOIN milestone_progress mp ON pe.id = mp.enrollment_id AND m.id = mp.milestone_id
         WHERE pe.student_id = $1 
         AND pe.status = 'active'
         AND (mp.status IS NULL OR mp.status IN ('not_started', 'in_progress'))
         ORDER BY lp.title, m.order_index
         LIMIT $2`,
        [studentId, limit]
      );

      const upcomingMilestones: UpcomingMilestone[] = [];

      for (const row of rows) {
        // Check if prerequisites are met
        const prerequisiteValidation = await ProgressTrackingService.validatePrerequisites(
          studentId, 
          row.milestone_id
        );

        // Determine priority based on current milestone and order
        let priority: 'high' | 'medium' | 'low' = 'medium';
        if (row.milestone_id === row.current_milestone_id) {
          priority = 'high';
        } else if (row.order_index === 0) {
          priority = 'high';
        } else if (row.status === 'in_progress') {
          priority = 'high';
        } else {
          priority = 'low';
        }

        upcomingMilestones.push({
          milestoneId: row.milestone_id,
          title: row.title,
          description: row.description,
          pathId: row.path_id,
          pathTitle: row.path_title,
          estimatedDuration: row.estimated_duration_hours,
          priority,
          prerequisitesMet: prerequisiteValidation.isValid
        });
      }

      return upcomingMilestones;
    } catch (error) {
      logger.error("Failed to get upcoming milestones", {
        studentId,
        limit,
        error: error instanceof Error ? error.message : error
      });
      return [];
    }
  },

  /**
   * Get student achievements
   */
  async getStudentAchievements(studentId: string): Promise<Achievement[]> {
    try {
      // TODO: Implement achievement system
      // This would fetch achievements from a dedicated achievements table
      
      return [];
    } catch (error) {
      logger.error("Failed to get student achievements", {
        studentId,
        error: error instanceof Error ? error.message : error
      });
      return [];
    }
  },

  /**
   * Get learning streak information
   */
  async getLearningStreak(studentId: string): Promise<StreakInfo> {
    try {
      const currentStreak = await this.calculateCurrentStreak(studentId);
      const longestStreak = await this.calculateLongestStreak(studentId);
      
      // Get last activity date
      const { rows: lastActivityRows } = await pool.query(
        `SELECT MAX(mp.updated_at) as last_activity
         FROM path_enrollments pe
         JOIN milestone_progress mp ON pe.id = mp.enrollment_id
         WHERE pe.student_id = $1`,
        [studentId]
      );

      const lastActivity = lastActivityRows[0]?.last_activity;
      const lastActivityDate = lastActivity ? new Date(lastActivity).toISOString() : undefined;

      // Calculate days until streak breaks (assuming 1 day grace period)
      const daysUntilBreak = lastActivity 
        ? Math.max(0, 2 - Math.floor((Date.now() - new Date(lastActivity).getTime()) / (1000 * 60 * 60 * 24)))
        : 0;

      return {
        current: currentStreak,
        longest: longestStreak,
        lastActivityDate,
        daysUntilBreak
      };
    } catch (error) {
      logger.error("Failed to get learning streak", {
        studentId,
        error: error instanceof Error ? error.message : error
      });
      
      return {
        current: 0,
        longest: 0,
        daysUntilBreak: 0
      };
    }
  },

  /**
   * Get learning recommendations for the student
   */
  async getLearningRecommendations(studentId: string): Promise<LearningRecommendation[]> {
    try {
      const recommendations: LearningRecommendation[] = [];

      // Get active enrollments for continue recommendations
      const { enrollments } = await EnrollmentModel.findByStudentId(studentId, { 
        status: 'active',
        limit: 5 
      });

      for (const enrollment of enrollments) {
        const progress = await ProgressTrackingService.getStudentProgress(enrollment.id);
        
        if (progress.enrollment.progressPercentage < 100) {
          recommendations.push({
            type: 'continue_path',
            title: `Continue "${progress.enrollment.learningPathId}"`,
            description: `You're ${Math.round(progress.enrollment.progressPercentage)}% complete`,
            priority: progress.enrollment.progressPercentage > 50 ? 1 : 2,
            pathId: progress.enrollment.learningPathId
          });
        }
      }

      // TODO: Add more sophisticated recommendations based on:
      // - Learning history
      // - Skill gaps
      // - Popular paths
      // - Mentor recommendations

      return recommendations.slice(0, 5); // Limit to top 5 recommendations
    } catch (error) {
      logger.error("Failed to get learning recommendations", {
        studentId,
        error: error instanceof Error ? error.message : error
      });
      return [];
    }
  },

  /**
   * Calculate current learning streak
   */
  async calculateCurrentStreak(studentId: string): Promise<number> {
    try {
      // Get activity dates for the last 30 days
      const { rows } = await pool.query(
        `SELECT DISTINCT DATE(mp.updated_at) as activity_date
         FROM path_enrollments pe
         JOIN milestone_progress mp ON pe.id = mp.enrollment_id
         WHERE pe.student_id = $1 
         AND mp.updated_at >= NOW() - INTERVAL '30 days'
         ORDER BY activity_date DESC`,
        [studentId]
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
          // Allow for one day gap
          streak++;
          currentDate = new Date(activityDate);
        } else {
          break;
        }
      }

      return streak;
    } catch (error) {
      logger.error("Failed to calculate current streak", {
        studentId,
        error: error instanceof Error ? error.message : error
      });
      return 0;
    }
  },

  /**
   * Calculate longest learning streak
   */
  async calculateLongestStreak(studentId: string): Promise<number> {
    try {
      // Get all activity dates
      const { rows } = await pool.query(
        `SELECT DISTINCT DATE(mp.updated_at) as activity_date
         FROM path_enrollments pe
         JOIN milestone_progress mp ON pe.id = mp.enrollment_id
         WHERE pe.student_id = $1 
         ORDER BY activity_date ASC`,
        [studentId]
      );

      if (rows.length === 0) return 0;

      let longestStreak = 0;
      let currentStreak = 1;
      let previousDate = new Date(rows[0].activity_date);

      for (let i = 1; i < rows.length; i++) {
        const currentDate = new Date(rows[i].activity_date);
        const daysDiff = Math.floor((currentDate.getTime() - previousDate.getTime()) / (1000 * 60 * 60 * 24));

        if (daysDiff === 1) {
          currentStreak++;
        } else if (daysDiff === 2) {
          // Allow for one day gap
          currentStreak++;
        } else {
          longestStreak = Math.max(longestStreak, currentStreak);
          currentStreak = 1;
        }

        previousDate = currentDate;
      }

      return Math.max(longestStreak, currentStreak);
    } catch (error) {
      logger.error("Failed to calculate longest streak", {
        studentId,
        error: error instanceof Error ? error.message : error
      });
      return 0;
    }
  }
};