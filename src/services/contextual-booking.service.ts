import pool from "../config/database";
import { CacheService } from "./cache.service";
import { CacheKeys, CacheTTL } from "../utils/cache-key.utils";
import { logger } from "../utils/logger.utils";
import { createError } from "../middleware/errorHandler";
import { BookingsService, CreateBookingData } from "./bookings.service";
import { SessionMilestoneService, AvailableSession } from "./session-milestone.service";

export interface LearningPathBookingContext {
  pathId: string;
  pathTitle: string;
  currentMilestoneId: string | null;
  currentMilestoneTitle: string | null;
  nextMilestoneId: string | null;
  nextMilestoneTitle: string | null;
  progressPercentage: number;
  availableSessions: AvailableSession[];
  recommendedSessionType: 'milestone' | 'support' | 'assessment';
  canBookMilestoneSession: boolean;
  prerequisitesMet: boolean;
}

export interface ContextualBookingData extends CreateBookingData {
  milestoneId?: string;
  sessionType?: 'milestone' | 'support' | 'assessment';
  contributesToCompletion?: boolean;
}

export interface BookingRecommendation {
  milestoneId: string;
  milestoneTitle: string;
  sessionType: 'milestone' | 'support' | 'assessment';
  priority: 'high' | 'medium' | 'low';
  reason: string;
  estimatedDuration: number;
  prerequisitesMet: boolean;
}

export const ContextualBookingService = {
  /**
   * Get learning path context for booking sessions
   */
  async getLearningPathContext(
    mentorId: string,
    studentId: string
  ): Promise<LearningPathBookingContext[]> {
    const cacheKey = CacheKeys.learningPathContext(mentorId, studentId);
    
    // Try cache first
    const cached = await CacheService.get<LearningPathBookingContext[]>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    // Get active enrollments for student with this mentor
    const { rows: enrollments } = await pool.query(
      `SELECT 
         pe.id as enrollment_id,
         pe.learning_path_id,
         pe.progress_percentage,
         pe.current_milestone_id,
         lp.title as path_title,
         lp.mentor_id,
         cm.title as current_milestone_title,
         nm.id as next_milestone_id,
         nm.title as next_milestone_title
       FROM path_enrollments pe
       JOIN learning_paths lp ON pe.learning_path_id = lp.id
       LEFT JOIN milestones cm ON pe.current_milestone_id = cm.id
       LEFT JOIN milestones nm ON nm.learning_path_id = lp.id 
         AND nm.order_index = (
           SELECT COALESCE(cm.order_index, -1) + 1
           FROM milestones cm WHERE cm.id = pe.current_milestone_id
         )
       WHERE pe.student_id = $1 
         AND lp.mentor_id = $2 
         AND pe.status = 'active'
       ORDER BY pe.enrolled_at DESC`,
      [studentId, mentorId]
    );

    const contexts: LearningPathBookingContext[] = [];

    for (const enrollment of enrollments) {
      // Get available sessions for current or next milestone
      const targetMilestoneId = enrollment.current_milestone_id || enrollment.next_milestone_id;
      
      let availableSessions: AvailableSession[] = [];
      let canBookMilestoneSession = false;
      let prerequisitesMet = false;

      if (targetMilestoneId) {
        try {
          availableSessions = await SessionMilestoneService.getAvailableSessionsForMilestone(
            targetMilestoneId,
            studentId
          );
          
          // Check if milestone session can be booked
          const milestoneSession = availableSessions.find(s => s.sessionType === 'milestone');
          canBookMilestoneSession = milestoneSession?.prerequisitesMet || false;
          prerequisitesMet = canBookMilestoneSession;
        } catch (error) {
          logger.warn("Error getting available sessions", { 
            targetMilestoneId, 
            studentId, 
            error 
          });
        }
      }

      // Determine recommended session type
      let recommendedSessionType: 'milestone' | 'support' | 'assessment' = 'support';
      if (canBookMilestoneSession) {
        recommendedSessionType = 'milestone';
      } else if (availableSessions.some(s => s.sessionType === 'assessment' && s.prerequisitesMet)) {
        recommendedSessionType = 'assessment';
      }

      contexts.push({
        pathId: enrollment.learning_path_id,
        pathTitle: enrollment.path_title,
        currentMilestoneId: enrollment.current_milestone_id,
        currentMilestoneTitle: enrollment.current_milestone_title,
        nextMilestoneId: enrollment.next_milestone_id,
        nextMilestoneTitle: enrollment.next_milestone_title,
        progressPercentage: parseFloat(enrollment.progress_percentage) || 0,
        availableSessions,
        recommendedSessionType,
        canBookMilestoneSession,
        prerequisitesMet
      });
    }

    // Cache for 2 minutes
    await CacheService.set(cacheKey, contexts, CacheTTL.veryShort);

    return contexts;
  },

  /**
   * Create a contextual booking with automatic milestone linking
   */
  async createContextualBooking(
    data: ContextualBookingData
  ): Promise<{ booking: any; milestoneMapping?: any }> {
    // Create the booking first
    const booking = await BookingsService.createBooking({
      menteeId: data.menteeId,
      mentorId: data.mentorId,
      scheduledAt: data.scheduledAt,
      durationMinutes: data.durationMinutes,
      topic: data.topic,
      notes: data.notes
    });

    let milestoneMapping = null;

    // Link to milestone if specified
    if (data.milestoneId) {
      try {
        milestoneMapping = await SessionMilestoneService.linkSessionToMilestone(
          data.milestoneId,
          booking.id,
          data.sessionType || 'milestone',
          data.contributesToCompletion !== false, // Default to true
          data.menteeId
        );

        logger.info("Contextual booking created with milestone link", {
          bookingId: booking.id,
          milestoneId: data.milestoneId,
          sessionType: data.sessionType
        });
      } catch (error) {
        logger.warn("Failed to link booking to milestone", {
          bookingId: booking.id,
          milestoneId: data.milestoneId,
          error
        });
        // Don't fail the booking creation if milestone linking fails
      }
    }

    return { booking, milestoneMapping };
  },

  /**
   * Get booking recommendations based on learning path progress
   */
  async getBookingRecommendations(
    mentorId: string,
    studentId: string
  ): Promise<BookingRecommendation[]> {
    const contexts = await this.getLearningPathContext(mentorId, studentId);
    const recommendations: BookingRecommendation[] = [];

    for (const context of contexts) {
      // Recommend sessions for current milestone
      if (context.currentMilestoneId && context.canBookMilestoneSession) {
        recommendations.push({
          milestoneId: context.currentMilestoneId,
          milestoneTitle: context.currentMilestoneTitle!,
          sessionType: 'milestone',
          priority: 'high',
          reason: `Continue working on ${context.currentMilestoneTitle}`,
          estimatedDuration: 90,
          prerequisitesMet: true
        });
      }

      // Recommend support sessions if struggling
      if (context.currentMilestoneId && context.progressPercentage < 50) {
        recommendations.push({
          milestoneId: context.currentMilestoneId,
          milestoneTitle: context.currentMilestoneTitle!,
          sessionType: 'support',
          priority: 'medium',
          reason: `Get additional help with ${context.currentMilestoneTitle}`,
          estimatedDuration: 60,
          prerequisitesMet: true
        });
      }

      // Recommend assessment sessions if ready
      const assessmentSession = context.availableSessions.find(
        s => s.sessionType === 'assessment' && s.prerequisitesMet
      );
      if (assessmentSession) {
        recommendations.push({
          milestoneId: context.currentMilestoneId!,
          milestoneTitle: context.currentMilestoneTitle!,
          sessionType: 'assessment',
          priority: 'high',
          reason: `Ready for assessment of ${context.currentMilestoneTitle}`,
          estimatedDuration: assessmentSession.estimatedDuration,
          prerequisitesMet: true
        });
      }

      // Recommend next milestone if current is nearly complete
      if (context.nextMilestoneId && context.progressPercentage > 80) {
        recommendations.push({
          milestoneId: context.nextMilestoneId,
          milestoneTitle: context.nextMilestoneTitle!,
          sessionType: 'milestone',
          priority: 'medium',
          reason: `Prepare for next milestone: ${context.nextMilestoneTitle}`,
          estimatedDuration: 90,
          prerequisitesMet: context.prerequisitesMet
        });
      }
    }

    // Sort by priority
    const priorityOrder = { high: 3, medium: 2, low: 1 };
    recommendations.sort((a, b) => priorityOrder[b.priority] - priorityOrder[a.priority]);

    return recommendations;
  },

  /**
   * Get session suggestions for a specific milestone
   */
  async getMilestoneSessionSuggestions(
    milestoneId: string,
    studentId: string
  ): Promise<{
    milestone: any;
    currentProgress: number;
    suggestedSessions: AvailableSession[];
    nextSteps: string[];
  }> {
    // Get milestone details
    const { rows: milestoneRows } = await pool.query(
      `SELECT m.*, lp.title as path_title, lp.mentor_id,
              COALESCE(mp.progress_percentage, 0) as current_progress
       FROM milestones m
       JOIN learning_paths lp ON m.learning_path_id = lp.id
       LEFT JOIN path_enrollments pe ON lp.id = pe.learning_path_id AND pe.student_id = $2
       LEFT JOIN milestone_progress mp ON m.id = mp.milestone_id AND mp.enrollment_id = pe.id
       WHERE m.id = $1`,
      [milestoneId, studentId]
    );

    if (milestoneRows.length === 0) {
      throw createError("Milestone not found or access denied", 404);
    }

    const milestone = milestoneRows[0];
    const currentProgress = parseFloat(milestone.current_progress) || 0;

    // Get available sessions
    const suggestedSessions = await SessionMilestoneService.getAvailableSessionsForMilestone(
      milestoneId,
      studentId
    );

    // Generate next steps based on progress and completion criteria
    const nextSteps: string[] = [];
    const completionCriteria = milestone.completion_criteria || {};

    if (currentProgress < 25) {
      nextSteps.push("Book a milestone session to get started");
      nextSteps.push("Review learning objectives and resources");
    } else if (currentProgress < 75) {
      nextSteps.push("Continue with milestone sessions");
      nextSteps.push("Practice key concepts covered so far");
    } else {
      if (completionCriteria.type === 'assessment') {
        nextSteps.push("Book an assessment session to complete milestone");
      } else if (completionCriteria.type === 'project') {
        nextSteps.push("Submit project for milestone completion");
      } else {
        nextSteps.push("Book final session to complete milestone");
      }
    }

    return {
      milestone: {
        id: milestone.id,
        title: milestone.title,
        description: milestone.description,
        learningObjectives: milestone.learning_objectives || [],
        completionCriteria: milestone.completion_criteria || {},
        pathTitle: milestone.path_title
      },
      currentProgress,
      suggestedSessions,
      nextSteps
    };
  },

  /**
   * Check if a booking respects learning path prerequisites
   */
  async validateBookingPrerequisites(
    milestoneId: string,
    studentId: string,
    sessionType: 'milestone' | 'support' | 'assessment'
  ): Promise<{
    canBook: boolean;
    reason?: string;
    missingPrerequisites?: string[];
  }> {
    // Support sessions can always be booked
    if (sessionType === 'support') {
      return { canBook: true };
    }

    try {
      // Import here to avoid circular dependency
      const { PrerequisiteValidatorService } = await import("./prerequisite-validator.service");
      
      const validation = await PrerequisiteValidatorService.validatePrerequisites(
        studentId,
        milestoneId
      );

      if (validation.isValid) {
        return { canBook: true };
      }

      return {
        canBook: false,
        reason: validation.message,
        missingPrerequisites: validation.missingPrerequisites.map(p => 
          p.prerequisiteType === 'milestone' ? `Complete prerequisite milestone` : p.skillName || 'Unknown prerequisite'
        )
      };
    } catch (error) {
      logger.error("Error validating booking prerequisites", { milestoneId, studentId, error });
      return {
        canBook: false,
        reason: "Unable to validate prerequisites"
      };
    }
  },

  /**
   * Get booking history for a learning path
   */
  async getLearningPathBookingHistory(
    pathId: string,
    studentId: string
  ): Promise<Array<{
    booking: any;
    milestone?: any;
    sessionType?: string;
    contributesToCompletion?: boolean;
  }>> {
    const { rows } = await pool.query(
      `SELECT 
         b.*,
         ms.session_type,
         ms.contributes_to_completion,
         m.title as milestone_title,
         m.id as milestone_id
       FROM bookings b
       JOIN learning_paths lp ON lp.mentor_id = b.mentor_id
       LEFT JOIN milestone_sessions ms ON b.id = ms.booking_id
       LEFT JOIN milestones m ON ms.milestone_id = m.id
       WHERE lp.id = $1 AND b.mentee_id = $2
       ORDER BY b.scheduled_at DESC`,
      [pathId, studentId]
    );

    return rows.map(row => ({
      booking: {
        id: row.id,
        scheduled_at: row.scheduled_at,
        duration_minutes: row.duration_minutes,
        topic: row.topic,
        status: row.status,
        notes: row.notes,
        created_at: row.created_at
      },
      milestone: row.milestone_id ? {
        id: row.milestone_id,
        title: row.milestone_title
      } : undefined,
      sessionType: row.session_type,
      contributesToCompletion: row.contributes_to_completion
    }));
  }
};