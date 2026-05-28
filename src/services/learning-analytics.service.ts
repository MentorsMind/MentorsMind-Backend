import pool from "../config/database";
import { CacheService } from "./cache.service";
import { CacheKeys, CacheTTL } from "../utils/cache-key.utils";
import { logger } from "../utils/logger.utils";
import { createError } from "../middleware/errorHandler";

export interface PathAnalytics {
  pathId: string;
  pathTitle: string;
  totalEnrollments: number;
  activeStudents: number;
  completedStudents: number;
  averageCompletionTime: number;
  completionRate: number;
  dropoutRate: number;
  averageProgress: number;
  revenueGenerated: number;
  studentSatisfaction: number;
  milestoneAnalytics: MilestoneAnalytics[];
  trendData: TrendData;
  bottlenecks: Bottleneck[];
}

export interface MilestoneAnalytics {
  milestoneId: string;
  milestoneTitle: string;
  orderIndex: number;
  completionRate: number;
  averageTimeToComplete: number;
  dropoutRate: number;
  averageProgress: number;
  studentCount: number;
  difficultyRating: number;
  commonStruggles: string[];
  sessionCount: number;
  averageSessionEffectiveness: number;
}

export interface TrendData {
  enrollmentTrend: DataPoint[];
  completionTrend: DataPoint[];
  progressTrend: DataPoint[];
  revenueTrend: DataPoint[];
}

export interface DataPoint {
  date: string;
  value: number;
  label?: string;
}

export interface Bottleneck {
  milestoneId: string;
  milestoneTitle: string;
  severity: 'high' | 'medium' | 'low';
  reason: string;
  affectedStudents: number;
  averageStuckTime: number;
  recommendations: string[];
}

export interface StudentLearningProfile {
  studentId: string;
  studentName: string;
  learningStyle: 'visual' | 'auditory' | 'kinesthetic' | 'reading' | 'mixed';
  learningVelocity: number;
  averageSessionEffectiveness: number;
  preferredSessionTypes: string[];
  strongAreas: string[];
  improvementAreas: string[];
  engagementScore: number;
  consistencyScore: number;
  collaborationScore: number;
  predictedSuccessRate: number;
  recommendations: string[];
}

export interface PredictiveInsights {
  studentId: string;
  pathId: string;
  predictedCompletionDate: string;
  successProbability: number;
  riskFactors: RiskFactor[];
  interventionRecommendations: string[];
  optimalNextSteps: string[];
}

export interface RiskFactor {
  factor: string;
  severity: 'high' | 'medium' | 'low';
  description: string;
  mitigation: string;
}

export interface ComparisonAnalytics {
  studentId: string;
  pathId: string;
  studentMetrics: StudentMetrics;
  peerAverages: StudentMetrics;
  percentile: number;
  strengths: string[];
  areasForImprovement: string[];
}

export interface StudentMetrics {
  completionRate: number;
  averageProgress: number;
  learningVelocity: number;
  sessionEffectiveness: number;
  engagementScore: number;
  timeSpent: number;
}

export const LearningAnalyticsService = {
  /**
   * Get comprehensive analytics for a learning path
   */
  async getPathAnalytics(
    pathId: string,
    timeframe: 'week' | 'month' | 'quarter' | 'year' | 'all' = 'all'
  ): Promise<PathAnalytics> {
    const cacheKey = CacheKeys.pathAnalytics(pathId) + `:${timeframe}`;
    
    // Try cache first
    const cached = await CacheService.get<PathAnalytics>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    // Get basic path information
    const { rows: pathRows } = await pool.query(
      `SELECT id, title, enrolled_count, completion_count, rating
       FROM learning_paths WHERE id = $1`,
      [pathId]
    );

    if (pathRows.length === 0) {
      throw createError("Learning path not found", 404);
    }

    const path = pathRows[0];
    const timeFilter = this.getTimeFilter(timeframe);

    // Get enrollment statistics
    const { rows: enrollmentStats } = await pool.query(
      `SELECT 
         COUNT(*) as total_enrollments,
         COUNT(CASE WHEN status = 'active' THEN 1 END) as active_students,
         COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_students,
         AVG(CASE WHEN status = 'completed' THEN 
           EXTRACT(EPOCH FROM (completed_at - enrolled_at))/3600 
         END) as avg_completion_hours,
         AVG(progress_percentage) as avg_progress
       FROM path_enrollments
       WHERE learning_path_id = $1 AND enrolled_at >= $2`,
      [pathId, timeFilter]
    );

    const stats = enrollmentStats[0];
    const totalEnrollments = parseInt(stats.total_enrollments);
    const completedStudents = parseInt(stats.completed_students);
    const completionRate = totalEnrollments > 0 ? (completedStudents / totalEnrollments) * 100 : 0;
    const dropoutRate = 100 - completionRate;

    // Get milestone analytics
    const milestoneAnalytics = await this.getMilestoneAnalytics(pathId, timeFilter);

    // Get trend data
    const trendData = await this.getTrendData(pathId, timeframe);

    // Identify bottlenecks
    const bottlenecks = await this.identifyBottlenecks(pathId, milestoneAnalytics);

    // Calculate revenue (placeholder - would integrate with payment system)
    const revenueGenerated = completedStudents * (path.total_price || 0);

    const analytics: PathAnalytics = {
      pathId,
      pathTitle: path.title,
      totalEnrollments,
      activeStudents: parseInt(stats.active_students),
      completedStudents,
      averageCompletionTime: parseFloat(stats.avg_completion_hours) || 0,
      completionRate,
      dropoutRate,
      averageProgress: parseFloat(stats.avg_progress) || 0,
      revenueGenerated,
      studentSatisfaction: parseFloat(path.rating) || 0,
      milestoneAnalytics,
      trendData,
      bottlenecks
    };

    // Cache for 10 minutes
    await CacheService.set(cacheKey, analytics, CacheTTL.medium * 2);

    return analytics;
  },

  /**
   * Get milestone analytics for a learning path
   */
  async getMilestoneAnalytics(
    pathId: string,
    timeFilter: Date
  ): Promise<MilestoneAnalytics[]> {
    const { rows } = await pool.query(
      `SELECT 
         m.id, m.title, m.order_index,
         COUNT(DISTINCT mp.enrollment_id) as student_count,
         COUNT(CASE WHEN mp.status = 'completed' THEN 1 END) as completed_count,
         AVG(mp.progress_percentage) as avg_progress,
         AVG(mp.time_spent_minutes) as avg_time_minutes,
         COUNT(ms.id) as session_count,
         AVG(so.session_effectiveness) as avg_effectiveness
       FROM milestones m
       LEFT JOIN milestone_progress mp ON m.id = mp.milestone_id
       LEFT JOIN milestone_sessions ms ON m.id = ms.milestone_id
       LEFT JOIN session_outcomes so ON ms.booking_id = so.booking_id
       WHERE m.learning_path_id = $1 AND mp.created_at >= $2
       GROUP BY m.id, m.title, m.order_index
       ORDER BY m.order_index`,
      [pathId, timeFilter]
    );

    return rows.map(row => {
      const studentCount = parseInt(row.student_count) || 0;
      const completedCount = parseInt(row.completed_count) || 0;
      const completionRate = studentCount > 0 ? (completedCount / studentCount) * 100 : 0;
      
      return {
        milestoneId: row.id,
        milestoneTitle: row.title,
        orderIndex: row.order_index,
        completionRate,
        averageTimeToComplete: parseFloat(row.avg_time_minutes) || 0,
        dropoutRate: 100 - completionRate,
        averageProgress: parseFloat(row.avg_progress) || 0,
        studentCount,
        difficultyRating: this.calculateDifficultyRating(row),
        commonStruggles: [],
        sessionCount: parseInt(row.session_count) || 0,
        averageSessionEffectiveness: parseFloat(row.avg_effectiveness) || 0
      };
    });
  },

  /**
   * Get trend data for a learning path
   */
  async getTrendData(
    pathId: string,
    timeframe: 'week' | 'month' | 'quarter' | 'year' | 'all'
  ): Promise<TrendData> {
    const interval = this.getIntervalForTimeframe(timeframe);
    
    const { rows } = await pool.query(
      `SELECT 
         date_trunc($2, enrolled_at) as period,
         COUNT(*) as enrollments,
         COUNT(CASE WHEN status = 'completed' THEN 1 END) as completions,
         AVG(progress_percentage) as avg_progress
       FROM path_enrollments
       WHERE learning_path_id = $1
       GROUP BY period
       ORDER BY period`,
      [pathId, interval]
    );

    return {
      enrollmentTrend: rows.map(r => ({ date: r.period, value: parseInt(r.enrollments) })),
      completionTrend: rows.map(r => ({ date: r.period, value: parseInt(r.completions) })),
      progressTrend: rows.map(r => ({ date: r.period, value: parseFloat(r.avg_progress) })),
      revenueTrend: []
    };
  },

  /**
   * Identify bottlenecks in learning path
   */
  async identifyBottlenecks(
    pathId: string,
    milestoneAnalytics: MilestoneAnalytics[]
  ): Promise<Bottleneck[]> {
    const bottlenecks: Bottleneck[] = [];

    for (const milestone of milestoneAnalytics) {
      if (milestone.completionRate < 50 && milestone.studentCount > 5) {
        bottlenecks.push({
          milestoneId: milestone.milestoneId,
          milestoneTitle: milestone.milestoneTitle,
          severity: milestone.completionRate < 30 ? 'high' : 'medium',
          reason: `Low completion rate (${milestone.completionRate.toFixed(1)}%)`,
          affectedStudents: milestone.studentCount,
          averageStuckTime: milestone.averageTimeToComplete,
          recommendations: [
            'Consider breaking down into smaller milestones',
            'Add more support sessions',
            'Review prerequisite requirements'
          ]
        });
      }
    }

    return bottlenecks;
  },

  // Helper methods
  private getTimeFilter(timeframe: string): Date {
    const now = new Date();
    switch (timeframe) {
      case 'week': return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      case 'month': return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      case 'quarter': return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      case 'year': return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      default: return new Date(0);
    }
  },

  private getIntervalForTimeframe(timeframe: string): string {
    switch (timeframe) {
      case 'week': return 'day';
      case 'month': return 'day';
      case 'quarter': return 'week';
      case 'year': return 'month';
      default: return 'month';
    }
  },

  private calculateDifficultyRating(data: any): number {
    const completionRate = parseFloat(data.completion_rate) || 0;
    const avgTime = parseFloat(data.avg_time_minutes) || 0;
    
    if (completionRate > 80 && avgTime < 120) return 1; // Easy
    if (completionRate > 60 && avgTime < 240) return 2; // Moderate
    if (completionRate > 40) return 3; // Challenging
    return 4; // Difficult
  },

  /**
   * Get student learning profile with behavioral analytics
   */
  async getStudentLearningProfile(
    studentId: string,
    pathId?: string
  ): Promise<StudentLearningProfile> {
    try {
      const cacheKey = `analytics:student:${studentId}:profile${pathId ? `:${pathId}` : ''}`;
      
      // Try cache first
      const cached = await CacheService.get<StudentLearningProfile>(cacheKey);
      if (cached !== null) {
        return cached;
      }

      // Get student information
      const { rows: studentRows } = await pool.query(
        `SELECT id, first_name, last_name FROM users WHERE id = $1`,
        [studentId]
      );

      if (studentRows.length === 0) {
        throw createError("Student not found", 404);
      }

      const student = studentRows[0];
      const studentName = `${student.first_name} ${student.last_name}`;

      // Build query conditions
      const pathCondition = pathId ? 'AND pe.learning_path_id = $2' : '';
      const queryParams = pathId ? [studentId, pathId] : [studentId];

      // Get learning velocity (milestones per week)
      const { rows: velocityRows } = await pool.query(
        `SELECT 
           COUNT(CASE WHEN mp.status = 'completed' THEN 1 END) as completed_milestones,
           EXTRACT(EPOCH FROM (MAX(mp.completed_at) - MIN(mp.started_at)))/604800 as weeks
         FROM milestone_progress mp
         JOIN path_enrollments pe ON mp.enrollment_id = pe.id
         WHERE pe.student_id = $1 ${pathCondition}
         AND mp.status = 'completed'`,
        queryParams
      );

      const velocityData = velocityRows[0];
      const weeks = parseFloat(velocityData.weeks) || 1;
      const learningVelocity = parseInt(velocityData.completed_milestones) / weeks;

      // Get session effectiveness
      const { rows: sessionRows } = await pool.query(
        `SELECT AVG(so.session_effectiveness) as avg_effectiveness
         FROM session_outcomes so
         JOIN bookings b ON so.booking_id = b.id
         WHERE b.student_id = $1`,
        [studentId]
      );

      const averageSessionEffectiveness = parseFloat(sessionRows[0]?.avg_effectiveness) || 0;

      // Calculate engagement score (based on activity frequency)
      const { rows: engagementRows } = await pool.query(
        `SELECT 
           COUNT(DISTINCT DATE(mp.updated_at)) as active_days,
           EXTRACT(EPOCH FROM (MAX(mp.updated_at) - MIN(mp.created_at)))/86400 as total_days
         FROM milestone_progress mp
         JOIN path_enrollments pe ON mp.enrollment_id = pe.id
         WHERE pe.student_id = $1 ${pathCondition}`,
        queryParams
      );

      const engagementData = engagementRows[0];
      const activeDays = parseInt(engagementData.active_days) || 0;
      const totalDays = parseFloat(engagementData.total_days) || 1;
      const engagementScore = Math.min((activeDays / totalDays) * 100, 100);

      // Calculate consistency score (streak-based)
      const consistencyScore = await this.calculateConsistencyScore(studentId, pathId);

      // Get collaboration score
      const collaborationScore = await this.calculateCollaborationScore(studentId);

      // Determine learning style (simplified heuristic)
      const learningStyle = this.determineLearningStyle(averageSessionEffectiveness, learningVelocity);

      // Identify strong areas and improvement areas
      const { strongAreas, improvementAreas } = await this.identifyStrengthsAndWeaknesses(studentId, pathId);

      // Calculate predicted success rate
      const predictedSuccessRate = this.calculateSuccessRate(
        learningVelocity,
        engagementScore,
        consistencyScore,
        averageSessionEffectiveness
      );

      // Generate recommendations
      const recommendations = this.generateLearningRecommendations(
        learningVelocity,
        engagementScore,
        consistencyScore,
        improvementAreas
      );

      const profile: StudentLearningProfile = {
        studentId,
        studentName,
        learningStyle,
        learningVelocity,
        averageSessionEffectiveness,
        preferredSessionTypes: ['milestone', 'support'], // Placeholder
        strongAreas,
        improvementAreas,
        engagementScore,
        consistencyScore,
        collaborationScore,
        predictedSuccessRate,
        recommendations
      };

      // Cache for 30 minutes
      await CacheService.set(cacheKey, profile, CacheTTL.medium);

      return profile;
    } catch (error) {
      logger.error("Failed to get student learning profile", {
        studentId,
        pathId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Get predictive insights for student success
   */
  async getPredictiveInsights(
    studentId: string,
    pathId: string
  ): Promise<PredictiveInsights> {
    try {
      const cacheKey = `analytics:predictive:${studentId}:${pathId}`;
      
      // Try cache first
      const cached = await CacheService.get<PredictiveInsights>(cacheKey);
      if (cached !== null) {
        return cached;
      }

      // Get enrollment
      const { rows: enrollmentRows } = await pool.query(
        `SELECT * FROM path_enrollments 
         WHERE student_id = $1 AND learning_path_id = $2`,
        [studentId, pathId]
      );

      if (enrollmentRows.length === 0) {
        throw createError("Enrollment not found", 404);
      }

      const enrollment = enrollmentRows[0];

      // Get learning profile
      const profile = await this.getStudentLearningProfile(studentId, pathId);

      // Calculate predicted completion date
      const { rows: progressRows } = await pool.query(
        `SELECT 
           COUNT(*) as total_milestones,
           COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_milestones
         FROM milestone_progress mp
         WHERE mp.enrollment_id = $1`,
        [enrollment.id]
      );

      const progressData = progressRows[0];
      const totalMilestones = parseInt(progressData.total_milestones);
      const completedMilestones = parseInt(progressData.completed_milestones);
      const remainingMilestones = totalMilestones - completedMilestones;

      const weeksToComplete = profile.learningVelocity > 0 
        ? remainingMilestones / profile.learningVelocity 
        : remainingMilestones * 2; // Default 2 weeks per milestone

      const predictedCompletionDate = new Date();
      predictedCompletionDate.setDate(predictedCompletionDate.getDate() + (weeksToComplete * 7));

      // Identify risk factors
      const riskFactors = this.identifyRiskFactors(profile, enrollment);

      // Calculate success probability
      const successProbability = profile.predictedSuccessRate;

      // Generate intervention recommendations
      const interventionRecommendations = this.generateInterventions(riskFactors, profile);

      // Generate optimal next steps
      const optimalNextSteps = await this.generateOptimalNextSteps(studentId, pathId, profile);

      const insights: PredictiveInsights = {
        studentId,
        pathId,
        predictedCompletionDate: predictedCompletionDate.toISOString(),
        successProbability,
        riskFactors,
        interventionRecommendations,
        optimalNextSteps
      };

      // Cache for 1 hour
      await CacheService.set(cacheKey, insights, CacheTTL.long);

      return insights;
    } catch (error) {
      logger.error("Failed to get predictive insights", {
        studentId,
        pathId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Get comparison analytics (student vs peers)
   */
  async getComparisonAnalytics(
    studentId: string,
    pathId: string
  ): Promise<ComparisonAnalytics> {
    try {
      const cacheKey = `analytics:comparison:${studentId}:${pathId}`;
      
      // Try cache first
      const cached = await CacheService.get<ComparisonAnalytics>(cacheKey);
      if (cached !== null) {
        return cached;
      }

      // Get student metrics
      const studentMetrics = await this.getStudentMetrics(studentId, pathId);

      // Get peer averages
      const peerAverages = await this.getPeerAverages(pathId, studentId);

      // Calculate percentile
      const percentile = await this.calculatePercentile(studentId, pathId);

      // Identify strengths and areas for improvement
      const strengths: string[] = [];
      const areasForImprovement: string[] = [];

      if (studentMetrics.completionRate > peerAverages.completionRate) {
        strengths.push('Completion rate above average');
      } else {
        areasForImprovement.push('Completion rate below average');
      }

      if (studentMetrics.learningVelocity > peerAverages.learningVelocity) {
        strengths.push('Learning pace faster than peers');
      } else if (studentMetrics.learningVelocity < peerAverages.learningVelocity * 0.7) {
        areasForImprovement.push('Learning pace slower than peers');
      }

      if (studentMetrics.engagementScore > peerAverages.engagementScore) {
        strengths.push('Higher engagement than peers');
      } else {
        areasForImprovement.push('Lower engagement than peers');
      }

      const analytics: ComparisonAnalytics = {
        studentId,
        pathId,
        studentMetrics,
        peerAverages,
        percentile,
        strengths,
        areasForImprovement
      };

      // Cache for 15 minutes
      await CacheService.set(cacheKey, analytics, CacheTTL.medium);

      return analytics;
    } catch (error) {
      logger.error("Failed to get comparison analytics", {
        studentId,
        pathId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Get mentor dashboard analytics
   */
  async getMentorDashboardAnalytics(mentorId: string): Promise<any> {
    try {
      const cacheKey = `analytics:mentor:${mentorId}:dashboard`;
      
      // Try cache first
      const cached = await CacheService.get<any>(cacheKey);
      if (cached !== null) {
        return cached;
      }

      // Get mentor's learning paths
      const { rows: pathRows } = await pool.query(
        `SELECT id, title, enrolled_count, completion_count, rating
         FROM learning_paths 
         WHERE mentor_id = $1 AND deleted_at IS NULL`,
        [mentorId]
      );

      // Get aggregate statistics
      const totalPaths = pathRows.length;
      const totalEnrollments = pathRows.reduce((sum, p) => sum + p.enrolled_count, 0);
      const totalCompletions = pathRows.reduce((sum, p) => sum + p.completion_count, 0);
      const averageRating = pathRows.length > 0
        ? pathRows.reduce((sum, p) => sum + parseFloat(p.rating), 0) / pathRows.length
        : 0;

      // Get active students
      const { rows: activeStudentRows } = await pool.query(
        `SELECT COUNT(DISTINCT student_id) as active_students
         FROM path_enrollments pe
         JOIN learning_paths lp ON pe.learning_path_id = lp.id
         WHERE lp.mentor_id = $1 AND pe.status = 'active'`,
        [mentorId]
      );

      const activeStudents = parseInt(activeStudentRows[0].active_students);

      // Get students needing attention
      const { rows: attentionRows } = await pool.query(
        `SELECT pe.id, pe.student_id, lp.title, pe.progress_percentage,
                EXTRACT(EPOCH FROM (NOW() - MAX(mp.updated_at)))/86400 as days_inactive
         FROM path_enrollments pe
         JOIN learning_paths lp ON pe.learning_path_id = lp.id
         LEFT JOIN milestone_progress mp ON pe.id = mp.enrollment_id
         WHERE lp.mentor_id = $1 AND pe.status = 'active'
         GROUP BY pe.id, pe.student_id, lp.title, pe.progress_percentage
         HAVING EXTRACT(EPOCH FROM (NOW() - MAX(mp.updated_at)))/86400 > 7
         ORDER BY days_inactive DESC
         LIMIT 10`,
        [mentorId]
      );

      // Get top performing paths
      const topPaths = pathRows
        .sort((a, b) => b.completion_count - a.completion_count)
        .slice(0, 5)
        .map(p => ({
          pathId: p.id,
          title: p.title,
          enrollments: p.enrolled_count,
          completions: p.completion_count,
          rating: parseFloat(p.rating)
        }));

      const dashboard = {
        mentorId,
        summary: {
          totalPaths,
          totalEnrollments,
          totalCompletions,
          activeStudents,
          averageRating,
          completionRate: totalEnrollments > 0 ? (totalCompletions / totalEnrollments) * 100 : 0
        },
        topPaths,
        studentsNeedingAttention: attentionRows.map(r => ({
          enrollmentId: r.id,
          studentId: r.student_id,
          pathTitle: r.title,
          progress: parseFloat(r.progress_percentage),
          daysInactive: Math.round(parseFloat(r.days_inactive))
        })),
        recentActivity: [] // Placeholder for recent activity feed
      };

      // Cache for 5 minutes
      await CacheService.set(cacheKey, dashboard, CacheTTL.short);

      return dashboard;
    } catch (error) {
      logger.error("Failed to get mentor dashboard analytics", {
        mentorId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  // Helper methods for analytics calculations
  private async calculateConsistencyScore(studentId: string, pathId?: string): Promise<number> {
    const pathCondition = pathId ? 'AND pe.learning_path_id = $2' : '';
    const queryParams = pathId ? [studentId, pathId] : [studentId];

    const { rows } = await pool.query(
      `SELECT DATE(mp.updated_at) as activity_date
       FROM milestone_progress mp
       JOIN path_enrollments pe ON mp.enrollment_id = pe.id
       WHERE pe.student_id = $1 ${pathCondition}
       AND mp.updated_at >= NOW() - INTERVAL '30 days'
       GROUP BY DATE(mp.updated_at)
       ORDER BY activity_date DESC`,
      queryParams
    );

    if (rows.length === 0) return 0;

    let streak = 0;
    let currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);

    for (const row of rows) {
      const activityDate = new Date(row.activity_date);
      activityDate.setHours(0, 0, 0, 0);
      const daysDiff = Math.floor((currentDate.getTime() - activityDate.getTime()) / (1000 * 60 * 60 * 24));

      if (daysDiff === streak || daysDiff === streak + 1) {
        streak++;
        currentDate = new Date(activityDate);
      } else {
        break;
      }
    }

    return Math.min((streak / 30) * 100, 100);
  },

  private async calculateCollaborationScore(studentId: string): Promise<number> {
    const { rows } = await pool.query(
      `SELECT 
         COUNT(DISTINCT df.id) as forum_posts,
         COUNT(DISTINCT sgm.id) as study_groups,
         COUNT(DISTINCT pr.id) as peer_reviews
       FROM users u
       LEFT JOIN discussion_forum_posts df ON u.id = df.user_id
       LEFT JOIN study_group_members sgm ON u.id = sgm.student_id
       LEFT JOIN peer_reviews pr ON u.id = pr.reviewer_id
       WHERE u.id = $1`,
      [studentId]
    );

    const data = rows[0];
    const forumPosts = parseInt(data.forum_posts) || 0;
    const studyGroups = parseInt(data.study_groups) || 0;
    const peerReviews = parseInt(data.peer_reviews) || 0;

    const score = (forumPosts * 2) + (studyGroups * 10) + (peerReviews * 5);
    return Math.min(score, 100);
  },

  private determineLearningStyle(sessionEffectiveness: number, velocity: number): StudentLearningProfile['learningStyle'] {
    // Simplified heuristic - in production, this would use ML models
    if (sessionEffectiveness > 0.8 && velocity > 1.5) return 'visual';
    if (sessionEffectiveness > 0.7) return 'auditory';
    if (velocity > 1.2) return 'kinesthetic';
    if (velocity < 0.8) return 'reading';
    return 'mixed';
  },

  private async identifyStrengthsAndWeaknesses(
    studentId: string,
    pathId?: string
  ): Promise<{ strongAreas: string[]; improvementAreas: string[] }> {
    // Placeholder - would analyze milestone completion patterns, session feedback, etc.
    return {
      strongAreas: ['Problem solving', 'Consistent practice'],
      improvementAreas: ['Time management', 'Asking for help']
    };
  },

  private calculateSuccessRate(
    velocity: number,
    engagement: number,
    consistency: number,
    effectiveness: number
  ): number {
    const weights = { velocity: 0.25, engagement: 0.3, consistency: 0.25, effectiveness: 0.2 };
    
    const normalizedVelocity = Math.min(velocity / 2, 1) * 100;
    const score = (
      normalizedVelocity * weights.velocity +
      engagement * weights.engagement +
      consistency * weights.consistency +
      effectiveness * 100 * weights.effectiveness
    );

    return Math.min(Math.max(score, 0), 100);
  },

  private generateLearningRecommendations(
    velocity: number,
    engagement: number,
    consistency: number,
    improvementAreas: string[]
  ): string[] {
    const recommendations: string[] = [];

    if (velocity < 0.5) {
      recommendations.push('Consider scheduling more frequent study sessions');
    }
    if (engagement < 50) {
      recommendations.push('Try joining a study group to increase engagement');
    }
    if (consistency < 40) {
      recommendations.push('Set a regular study schedule to build consistency');
    }
    if (improvementAreas.includes('Time management')) {
      recommendations.push('Use time-blocking techniques for better time management');
    }

    return recommendations;
  },

  private identifyRiskFactors(profile: StudentLearningProfile, enrollment: any): RiskFactor[] {
    const riskFactors: RiskFactor[] = [];

    if (profile.engagementScore < 40) {
      riskFactors.push({
        factor: 'Low Engagement',
        severity: 'high',
        description: 'Student shows low engagement with learning materials',
        mitigation: 'Schedule check-in session with mentor'
      });
    }

    if (profile.learningVelocity < 0.3) {
      riskFactors.push({
        factor: 'Slow Progress',
        severity: 'medium',
        description: 'Learning pace is significantly below average',
        mitigation: 'Review learning objectives and adjust difficulty'
      });
    }

    if (profile.consistencyScore < 30) {
      riskFactors.push({
        factor: 'Inconsistent Activity',
        severity: 'medium',
        description: 'Irregular study patterns detected',
        mitigation: 'Help student establish regular study routine'
      });
    }

    return riskFactors;
  },

  private generateInterventions(riskFactors: RiskFactor[], profile: StudentLearningProfile): string[] {
    const interventions: string[] = [];

    for (const risk of riskFactors) {
      if (risk.severity === 'high') {
        interventions.push(`Urgent: ${risk.mitigation}`);
      } else {
        interventions.push(risk.mitigation);
      }
    }

    if (profile.collaborationScore < 20) {
      interventions.push('Encourage participation in study groups');
    }

    return interventions;
  },

  private async generateOptimalNextSteps(
    studentId: string,
    pathId: string,
    profile: StudentLearningProfile
  ): Promise<string[]> {
    const steps: string[] = [];

    // Get current milestone
    const { rows } = await pool.query(
      `SELECT m.title, m.learning_objectives
       FROM path_enrollments pe
       JOIN milestones m ON pe.current_milestone_id = m.id
       WHERE pe.student_id = $1 AND pe.learning_path_id = $2`,
      [studentId, pathId]
    );

    if (rows.length > 0) {
      const milestone = rows[0];
      steps.push(`Complete current milestone: ${milestone.title}`);
      
      if (profile.averageSessionEffectiveness < 0.6) {
        steps.push('Schedule a support session with your mentor');
      }
      
      if (profile.collaborationScore < 30) {
        steps.push('Join a study group for peer support');
      }
    }

    steps.push('Review learning objectives and track your progress');
    
    return steps;
  },

  private async getStudentMetrics(studentId: string, pathId: string): Promise<StudentMetrics> {
    const { rows } = await pool.query(
      `SELECT 
         pe.progress_percentage,
         COUNT(CASE WHEN mp.status = 'completed' THEN 1 END) as completed,
         COUNT(*) as total,
         SUM(mp.time_spent_minutes) as time_spent,
         AVG(so.session_effectiveness) as avg_effectiveness
       FROM path_enrollments pe
       LEFT JOIN milestone_progress mp ON pe.id = mp.enrollment_id
       LEFT JOIN milestone_sessions ms ON mp.milestone_id = ms.milestone_id
       LEFT JOIN session_outcomes so ON ms.booking_id = so.booking_id
       WHERE pe.student_id = $1 AND pe.learning_path_id = $2
       GROUP BY pe.id, pe.progress_percentage`,
      [studentId, pathId]
    );

    const data = rows[0] || {};
    const completed = parseInt(data.completed) || 0;
    const total = parseInt(data.total) || 1;

    return {
      completionRate: (completed / total) * 100,
      averageProgress: parseFloat(data.progress_percentage) || 0,
      learningVelocity: 0, // Would calculate from time data
      sessionEffectiveness: parseFloat(data.avg_effectiveness) || 0,
      engagementScore: 0, // Would calculate from activity data
      timeSpent: parseInt(data.time_spent) || 0
    };
  },

  private async getPeerAverages(pathId: string, excludeStudentId: string): Promise<StudentMetrics> {
    const { rows } = await pool.query(
      `SELECT 
         AVG(pe.progress_percentage) as avg_progress,
         AVG(CASE WHEN mp.status = 'completed' THEN 100 ELSE 0 END) as avg_completion,
         AVG(mp.time_spent_minutes) as avg_time,
         AVG(so.session_effectiveness) as avg_effectiveness
       FROM path_enrollments pe
       LEFT JOIN milestone_progress mp ON pe.id = mp.enrollment_id
       LEFT JOIN milestone_sessions ms ON mp.milestone_id = ms.milestone_id
       LEFT JOIN session_outcomes so ON ms.booking_id = so.booking_id
       WHERE pe.learning_path_id = $1 AND pe.student_id != $2`,
      [pathId, excludeStudentId]
    );

    const data = rows[0] || {};

    return {
      completionRate: parseFloat(data.avg_completion) || 0,
      averageProgress: parseFloat(data.avg_progress) || 0,
      learningVelocity: 0,
      sessionEffectiveness: parseFloat(data.avg_effectiveness) || 0,
      engagementScore: 0,
      timeSpent: parseInt(data.avg_time) || 0
    };
  },

  private async calculatePercentile(studentId: string, pathId: string): Promise<number> {
    const { rows } = await pool.query(
      `WITH student_progress AS (
         SELECT progress_percentage
         FROM path_enrollments
         WHERE student_id = $1 AND learning_path_id = $2
       ),
       all_progress AS (
         SELECT progress_percentage
         FROM path_enrollments
         WHERE learning_path_id = $2
       )
       SELECT 
         (SELECT progress_percentage FROM student_progress) as student_progress,
         COUNT(*) as total_students,
         COUNT(CASE WHEN ap.progress_percentage < sp.progress_percentage THEN 1 END) as students_below
       FROM all_progress ap, student_progress sp
       GROUP BY sp.progress_percentage`,
      [studentId, pathId]
    );

    if (rows.length === 0) return 50;

    const data = rows[0];
    const totalStudents = parseInt(data.total_students);
    const studentsBelow = parseInt(data.students_below);

    return (studentsBelow / totalStudents) * 100;
  }
};