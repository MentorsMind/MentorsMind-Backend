import pool from "../config/database";
import { CacheService } from "./cache.service";
import { CacheKeys } from "../utils/cache-key.utils";
import { logger } from "../utils/logger.utils";
import { createError } from "../middleware/errorHandler";
import { SessionMilestoneService } from "./session-milestone.service";
import { MilestoneCompletionService } from "./milestone-completion.service";
import { ProgressTrackingService } from "./progress-tracking.service";

export interface SessionOutcome {
  id: string;
  bookingId: string;
  milestoneId?: string;
  mentorFeedback?: string;
  studentFeedback?: string;
  objectivesAchieved: string[];
  skillsImproved: string[];
  nextSteps: string[];
  progressContribution: number; // 0-100 percentage
  completionStatus: 'not_started' | 'in_progress' | 'completed' | 'needs_review';
  sessionEffectiveness: number; // 1-5 rating
  recommendedFollowUp?: 'continue' | 'assessment' | 'support' | 'complete';
  createdAt: string;
  updatedAt: string;
}

export interface CreateSessionOutcomeData {
  bookingId: string;
  mentorFeedback?: string;
  studentFeedback?: string;
  objectivesAchieved?: string[];
  skillsImproved?: string[];
  nextSteps?: string[];
  progressContribution?: number;
  completionStatus?: 'not_started' | 'in_progress' | 'completed' | 'needs_review';
  sessionEffectiveness?: number;
  recommendedFollowUp?: 'continue' | 'assessment' | 'support' | 'complete';
}

export interface SessionImpactAnalysis {
  milestoneId: string;
  milestoneTitle: string;
  progressBefore: number;
  progressAfter: number;
  progressGain: number;
  objectivesCompleted: number;
  totalObjectives: number;
  recommendedActions: string[];
  isReadyForCompletion: boolean;
}

export const SessionOutcomeService = {
  /**
   * Create session outcome and update milestone progress
   */
  async createSessionOutcome(
    data: CreateSessionOutcomeData,
    userId: string
  ): Promise<SessionOutcome> {
    // Validate booking exists and user has access
    const { rows: bookingRows } = await pool.query(
      `SELECT * FROM bookings WHERE id = $1`,
      [data.bookingId]
    );

    if (bookingRows.length === 0) {
      throw createError("Booking not found", 404);
    }

    const booking = bookingRows[0];

    // Verify user is mentor or mentee
    if (booking.mentor_id !== userId && booking.mentee_id !== userId) {
      throw createError("Access denied to this booking", 403);
    }

    // Check if booking is completed
    if (booking.status !== 'completed') {
      throw createError("Can only create outcomes for completed sessions", 400);
    }

    // Get milestone mapping if exists
    const milestoneMapping = await SessionMilestoneService.getMilestoneForSession(data.bookingId);

    // Create session outcome record
    const { rows } = await pool.query<SessionOutcome>(
      `INSERT INTO session_outcomes (
         booking_id, milestone_id, mentor_feedback, student_feedback,
         objectives_achieved, skills_improved, next_steps, progress_contribution,
         completion_status, session_effectiveness, recommended_follow_up
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING 
         id, booking_id as "bookingId", milestone_id as "milestoneId",
         mentor_feedback as "mentorFeedback", student_feedback as "studentFeedback",
         objectives_achieved as "objectivesAchieved", skills_improved as "skillsImproved",
         next_steps as "nextSteps", progress_contribution as "progressContribution",
         completion_status as "completionStatus", session_effectiveness as "sessionEffectiveness",
         recommended_follow_up as "recommendedFollowUp", created_at as "createdAt",
         updated_at as "updatedAt"`,
      [
        data.bookingId,
        milestoneMapping?.milestoneId || null,
        data.mentorFeedback || null,
        data.studentFeedback || null,
        JSON.stringify(data.objectivesAchieved || []),
        JSON.stringify(data.skillsImproved || []),
        JSON.stringify(data.nextSteps || []),
        data.progressContribution || 0,
        data.completionStatus || 'in_progress',
        data.sessionEffectiveness || 3,
        data.recommendedFollowUp || null
      ]
    );

    const outcome = rows[0];

    // Update milestone progress if applicable
    if (milestoneMapping && milestoneMapping.contributesToCompletion && data.progressContribution) {
      await this.updateMilestoneProgressFromOutcome(
        milestoneMapping.milestoneId,
        booking.mentee_id,
        data.progressContribution,
        data.completionStatus || 'in_progress'
      );
    }

    // Invalidate relevant caches
    await this.invalidateOutcomeCaches(booking.mentee_id, milestoneMapping?.milestoneId);

    logger.info("Session outcome created", {
      bookingId: data.bookingId,
      milestoneId: milestoneMapping?.milestoneId,
      progressContribution: data.progressContribution,
      userId
    });

    return outcome;
  },

  /**
   * Update existing session outcome
   */
  async updateSessionOutcome(
    outcomeId: string,
    updates: Partial<CreateSessionOutcomeData>,
    userId: string
  ): Promise<SessionOutcome> {
    // Get existing outcome
    const existing = await this.getSessionOutcome(outcomeId, userId);
    if (!existing) {
      throw createError("Session outcome not found", 404);
    }

    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (updates.mentorFeedback !== undefined) {
      fields.push(`mentor_feedback = $${idx++}`);
      values.push(updates.mentorFeedback);
    }
    if (updates.studentFeedback !== undefined) {
      fields.push(`student_feedback = $${idx++}`);
      values.push(updates.studentFeedback);
    }
    if (updates.objectivesAchieved !== undefined) {
      fields.push(`objectives_achieved = $${idx++}`);
      values.push(JSON.stringify(updates.objectivesAchieved));
    }
    if (updates.skillsImproved !== undefined) {
      fields.push(`skills_improved = $${idx++}`);
      values.push(JSON.stringify(updates.skillsImproved));
    }
    if (updates.nextSteps !== undefined) {
      fields.push(`next_steps = $${idx++}`);
      values.push(JSON.stringify(updates.nextSteps));
    }
    if (updates.progressContribution !== undefined) {
      fields.push(`progress_contribution = $${idx++}`);
      values.push(updates.progressContribution);
    }
    if (updates.completionStatus !== undefined) {
      fields.push(`completion_status = $${idx++}`);
      values.push(updates.completionStatus);
    }
    if (updates.sessionEffectiveness !== undefined) {
      fields.push(`session_effectiveness = $${idx++}`);
      values.push(updates.sessionEffectiveness);
    }
    if (updates.recommendedFollowUp !== undefined) {
      fields.push(`recommended_follow_up = $${idx++}`);
      values.push(updates.recommendedFollowUp);
    }

    if (fields.length === 0) {
      return existing;
    }

    fields.push(`updated_at = NOW()`);
    values.push(outcomeId);

    const { rows } = await pool.query<SessionOutcome>(
      `UPDATE session_outcomes 
       SET ${fields.join(', ')}
       WHERE id = $${idx}
       RETURNING 
         id, booking_id as "bookingId", milestone_id as "milestoneId",
         mentor_feedback as "mentorFeedback", student_feedback as "studentFeedback",
         objectives_achieved as "objectivesAchieved", skills_improved as "skillsImproved",
         next_steps as "nextSteps", progress_contribution as "progressContribution",
         completion_status as "completionStatus", session_effectiveness as "sessionEffectiveness",
         recommended_follow_up as "recommendedFollowUp", created_at as "createdAt",
         updated_at as "updatedAt"`,
      values
    );

    const updated = rows[0];

    // Update milestone progress if contribution changed
    if (existing.milestoneId && updates.progressContribution !== undefined) {
      const { rows: bookingRows } = await pool.query(
        `SELECT mentee_id FROM bookings WHERE id = $1`,
        [existing.bookingId]
      );
      
      if (bookingRows.length > 0) {
        await this.updateMilestoneProgressFromOutcome(
          existing.milestoneId,
          bookingRows[0].mentee_id,
          updates.progressContribution,
          updates.completionStatus || existing.completionStatus
        );
      }
    }

    // Invalidate relevant caches
    const { rows: bookingRows } = await pool.query(
      `SELECT mentee_id FROM bookings WHERE id = $1`,
      [existing.bookingId]
    );
    
    if (bookingRows.length > 0) {
      await this.invalidateOutcomeCaches(bookingRows[0].mentee_id, existing.milestoneId);
    }

    logger.info("Session outcome updated", {
      outcomeId,
      updates: Object.keys(updates),
      userId
    });

    return updated;
  },

  /**
   * Get session outcome by ID
   */
  async getSessionOutcome(
    outcomeId: string,
    userId: string
  ): Promise<SessionOutcome | null> {
    const { rows } = await pool.query(
      `SELECT 
         so.id, so.booking_id as "bookingId", so.milestone_id as "milestoneId",
         so.mentor_feedback as "mentorFeedback", so.student_feedback as "studentFeedback",
         so.objectives_achieved as "objectivesAchieved", so.skills_improved as "skillsImproved",
         so.next_steps as "nextSteps", so.progress_contribution as "progressContribution",
         so.completion_status as "completionStatus", so.session_effectiveness as "sessionEffectiveness",
         so.recommended_follow_up as "recommendedFollowUp", so.created_at as "createdAt",
         so.updated_at as "updatedAt"
       FROM session_outcomes so
       JOIN bookings b ON so.booking_id = b.id
       WHERE so.id = $1 AND (b.mentor_id = $2 OR b.mentee_id = $2)`,
      [outcomeId, userId]
    );

    if (rows.length === 0) {
      return null;
    }

    const outcome = rows[0];
    
    // Parse JSON fields
    outcome.objectivesAchieved = JSON.parse(outcome.objectivesAchieved || '[]');
    outcome.skillsImproved = JSON.parse(outcome.skillsImproved || '[]');
    outcome.nextSteps = JSON.parse(outcome.nextSteps || '[]');

    return outcome;
  },

  /**
   * Get session outcome by booking ID
   */
  async getSessionOutcomeByBooking(
    bookingId: string,
    userId: string
  ): Promise<SessionOutcome | null> {
    const { rows } = await pool.query(
      `SELECT 
         so.id, so.booking_id as "bookingId", so.milestone_id as "milestoneId",
         so.mentor_feedback as "mentorFeedback", so.student_feedback as "studentFeedback",
         so.objectives_achieved as "objectivesAchieved", so.skills_improved as "skillsImproved",
         so.next_steps as "nextSteps", so.progress_contribution as "progressContribution",
         so.completion_status as "completionStatus", so.session_effectiveness as "sessionEffectiveness",
         so.recommended_follow_up as "recommendedFollowUp", so.created_at as "createdAt",
         so.updated_at as "updatedAt"
       FROM session_outcomes so
       JOIN bookings b ON so.booking_id = b.id
       WHERE so.booking_id = $1 AND (b.mentor_id = $2 OR b.mentee_id = $2)`,
      [bookingId, userId]
    );

    if (rows.length === 0) {
      return null;
    }

    const outcome = rows[0];
    
    // Parse JSON fields
    outcome.objectivesAchieved = JSON.parse(outcome.objectivesAchieved || '[]');
    outcome.skillsImproved = JSON.parse(outcome.skillsImproved || '[]');
    outcome.nextSteps = JSON.parse(outcome.nextSteps || '[]');

    return outcome;
  },

  /**
   * Get session outcomes for a milestone
   */
  async getMilestoneSessionOutcomes(
    milestoneId: string,
    userId: string
  ): Promise<SessionOutcome[]> {
    // Validate milestone access
    const { rows: accessRows } = await pool.query(
      `SELECT lp.mentor_id, pe.student_id
       FROM milestones m
       JOIN learning_paths lp ON m.learning_path_id = lp.id
       LEFT JOIN path_enrollments pe ON lp.id = pe.learning_path_id AND pe.student_id = $2
       WHERE m.id = $1`,
      [milestoneId, userId]
    );

    if (accessRows.length === 0) {
      throw createError("Milestone not found", 404);
    }

    const access = accessRows[0];
    if (access.mentor_id !== userId && access.student_id !== userId) {
      throw createError("Access denied to this milestone", 403);
    }

    const { rows } = await pool.query(
      `SELECT 
         so.id, so.booking_id as "bookingId", so.milestone_id as "milestoneId",
         so.mentor_feedback as "mentorFeedback", so.student_feedback as "studentFeedback",
         so.objectives_achieved as "objectivesAchieved", so.skills_improved as "skillsImproved",
         so.next_steps as "nextSteps", so.progress_contribution as "progressContribution",
         so.completion_status as "completionStatus", so.session_effectiveness as "sessionEffectiveness",
         so.recommended_follow_up as "recommendedFollowUp", so.created_at as "createdAt",
         so.updated_at as "updatedAt"
       FROM session_outcomes so
       WHERE so.milestone_id = $1
       ORDER BY so.created_at DESC`,
      [milestoneId]
    );

    return rows.map(outcome => ({
      ...outcome,
      objectivesAchieved: JSON.parse(outcome.objectivesAchieved || '[]'),
      skillsImproved: JSON.parse(outcome.skillsImproved || '[]'),
      nextSteps: JSON.parse(outcome.nextSteps || '[]')
    }));
  },

  /**
   * Analyze session impact on milestone progress
   */
  async analyzeSessionImpact(
    bookingId: string,
    userId: string
  ): Promise<SessionImpactAnalysis | null> {
    // Get session outcome
    const outcome = await this.getSessionOutcomeByBooking(bookingId, userId);
    if (!outcome || !outcome.milestoneId) {
      return null;
    }

    // Get milestone details and progress
    const { rows } = await pool.query(
      `SELECT 
         m.id, m.title, m.learning_objectives,
         mp.progress_percentage,
         pe.student_id
       FROM milestones m
       JOIN learning_paths lp ON m.learning_path_id = lp.id
       LEFT JOIN path_enrollments pe ON lp.id = pe.learning_path_id
       LEFT JOIN milestone_progress mp ON m.id = mp.milestone_id AND mp.enrollment_id = pe.id
       JOIN bookings b ON b.mentee_id = pe.student_id
       WHERE m.id = $1 AND b.id = $2`,
      [outcome.milestoneId, bookingId]
    );

    if (rows.length === 0) {
      return null;
    }

    const milestone = rows[0];
    const currentProgress = parseFloat(milestone.progress_percentage) || 0;
    const progressGain = outcome.progressContribution || 0;
    const progressBefore = Math.max(0, currentProgress - progressGain);

    const learningObjectives = milestone.learning_objectives || [];
    const objectivesCompleted = outcome.objectivesAchieved?.length || 0;

    // Generate recommendations based on progress and outcomes
    const recommendedActions: string[] = [];
    
    if (progressGain > 0) {
      recommendedActions.push(`Great progress! Gained ${progressGain}% completion`);
    }
    
    if (outcome.recommendedFollowUp === 'assessment') {
      recommendedActions.push("Ready for assessment - book an assessment session");
    } else if (outcome.recommendedFollowUp === 'support') {
      recommendedActions.push("Consider booking a support session for additional help");
    } else if (outcome.recommendedFollowUp === 'complete') {
      recommendedActions.push("Milestone is ready for completion");
    }

    if (outcome.sessionEffectiveness < 3) {
      recommendedActions.push("Session effectiveness was low - consider different approach");
    }

    const isReadyForCompletion = currentProgress >= 90 || outcome.completionStatus === 'completed';

    return {
      milestoneId: outcome.milestoneId,
      milestoneTitle: milestone.title,
      progressBefore,
      progressAfter: currentProgress,
      progressGain,
      objectivesCompleted,
      totalObjectives: learningObjectives.length,
      recommendedActions,
      isReadyForCompletion
    };
  },

  /**
   * Get session effectiveness analytics for a mentor
   */
  async getMentorSessionAnalytics(
    mentorId: string,
    timeframe: 'week' | 'month' | 'quarter' = 'month'
  ): Promise<{
    totalSessions: number;
    averageEffectiveness: number;
    averageProgressContribution: number;
    completionRate: number;
    topSkillsImproved: Array<{ skill: string; count: number }>;
    recommendationDistribution: Record<string, number>;
  }> {
    const timeCondition = this.getTimeCondition(timeframe);

    const { rows } = await pool.query(
      `SELECT 
         COUNT(*) as total_sessions,
         AVG(so.session_effectiveness) as avg_effectiveness,
         AVG(so.progress_contribution) as avg_progress,
         COUNT(CASE WHEN so.completion_status = 'completed' THEN 1 END) as completed_sessions,
         so.skills_improved,
         so.recommended_follow_up
       FROM session_outcomes so
       JOIN bookings b ON so.booking_id = b.id
       WHERE b.mentor_id = $1 AND so.created_at >= $2
       GROUP BY so.skills_improved, so.recommended_follow_up`,
      [mentorId, timeCondition]
    );

    if (rows.length === 0) {
      return {
        totalSessions: 0,
        averageEffectiveness: 0,
        averageProgressContribution: 0,
        completionRate: 0,
        topSkillsImproved: [],
        recommendationDistribution: {}
      };
    }

    // Aggregate results
    let totalSessions = 0;
    let totalEffectiveness = 0;
    let totalProgress = 0;
    let completedSessions = 0;
    const skillCounts: Record<string, number> = {};
    const recommendationCounts: Record<string, number> = {};

    for (const row of rows) {
      totalSessions += parseInt(row.total_sessions);
      totalEffectiveness += parseFloat(row.avg_effectiveness) * parseInt(row.total_sessions);
      totalProgress += parseFloat(row.avg_progress) * parseInt(row.total_sessions);
      completedSessions += parseInt(row.completed_sessions);

      // Count skills
      const skills = JSON.parse(row.skills_improved || '[]');
      for (const skill of skills) {
        skillCounts[skill] = (skillCounts[skill] || 0) + 1;
      }

      // Count recommendations
      if (row.recommended_follow_up) {
        recommendationCounts[row.recommended_follow_up] = 
          (recommendationCounts[row.recommended_follow_up] || 0) + parseInt(row.total_sessions);
      }
    }

    // Sort skills by count
    const topSkillsImproved = Object.entries(skillCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .map(([skill, count]) => ({ skill, count }));

    return {
      totalSessions,
      averageEffectiveness: totalSessions > 0 ? totalEffectiveness / totalSessions : 0,
      averageProgressContribution: totalSessions > 0 ? totalProgress / totalSessions : 0,
      completionRate: totalSessions > 0 ? (completedSessions / totalSessions) * 100 : 0,
      topSkillsImproved,
      recommendationDistribution: recommendationCounts
    };
  },

  // Private helper methods

  private async updateMilestoneProgressFromOutcome(
    milestoneId: string,
    studentId: string,
    progressContribution: number,
    completionStatus: string
  ): Promise<void> {
    try {
      // Get enrollment ID
      const { rows: enrollmentRows } = await pool.query(
        `SELECT pe.id as enrollment_id
         FROM path_enrollments pe
         JOIN learning_paths lp ON pe.learning_path_id = lp.id
         JOIN milestones m ON m.learning_path_id = lp.id
         WHERE m.id = $1 AND pe.student_id = $2`,
        [milestoneId, studentId]
      );

      if (enrollmentRows.length === 0) {
        logger.warn("No enrollment found for milestone progress update", { milestoneId, studentId });
        return;
      }

      const enrollmentId = enrollmentRows[0].enrollment_id;

      // Update progress using existing service
      await ProgressTrackingService.updateProgress(enrollmentId, milestoneId, progressContribution);

      // If completion status indicates completion, try to complete milestone
      if (completionStatus === 'completed') {
        try {
          await MilestoneCompletionService.completeMilestone(enrollmentId, milestoneId, {
            completionData: { source: 'session_outcome' },
            notes: 'Completed via session outcome'
          });
        } catch (error) {
          logger.warn("Could not auto-complete milestone from session outcome", { 
            milestoneId, 
            studentId, 
            error 
          });
        }
      }
    } catch (error) {
      logger.error("Error updating milestone progress from outcome", { 
        milestoneId, 
        studentId, 
        progressContribution, 
        error 
      });
    }
  },

  private async invalidateOutcomeCaches(studentId: string, milestoneId?: string): Promise<void> {
    const cacheKeys = [
      CacheKeys.studentProgress(studentId),
      CacheKeys.sessionList(studentId)
    ];

    if (milestoneId) {
      cacheKeys.push(CacheKeys.milestoneProgress(milestoneId));
    }

    await Promise.all(cacheKeys.map(key => CacheService.del(key)));
  },

  private getTimeCondition(timeframe: 'week' | 'month' | 'quarter'): Date {
    const now = new Date();
    switch (timeframe) {
      case 'week':
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      case 'month':
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      case 'quarter':
        return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      default:
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }
  }
};