import pool from "../config/database";
import { CacheService } from "./cache.service";
import { CacheKeys, CacheTTL } from "../utils/cache-key.utils";
import { logger } from "../utils/logger.utils";
import { createError } from "../middleware/errorHandler";
import { BookingRecord } from "../models/booking.model";
import { MilestoneProgress } from "../models/milestone.model";

export interface SessionMilestoneMapping {
  id: string;
  milestoneId: string;
  bookingId: string;
  sessionType: 'milestone' | 'support' | 'assessment';
  contributesToCompletion: boolean;
  createdAt: string;
}

export interface SessionMilestoneContext {
  milestoneId: string;
  milestoneTitle: string;
  learningObjectives: string[];
  completionCriteria: any;
  currentProgress: number;
  prerequisitesMet: boolean;
  sessionType: 'milestone' | 'support' | 'assessment';
}

export interface AvailableSession {
  sessionType: 'milestone' | 'support' | 'assessment';
  title: string;
  description: string;
  estimatedDuration: number;
  isRecommended: boolean;
  prerequisitesMet: boolean;
}

export const SessionMilestoneService = {
  /**
   * Associate a session (booking) with a specific milestone
   */
  async linkSessionToMilestone(
    milestoneId: string,
    bookingId: string,
    sessionType: 'milestone' | 'support' | 'assessment' = 'milestone',
    contributesToCompletion: boolean = true,
    userId: string
  ): Promise<SessionMilestoneMapping> {
    // Validate milestone exists and user has access
    const milestone = await this.validateMilestoneAccess(milestoneId, userId);
    
    // Validate booking exists and user has access
    const booking = await this.validateBookingAccess(bookingId, userId);
    
    // Check if mapping already exists
    const existingMapping = await this.getMappingByBookingId(bookingId);
    if (existingMapping) {
      throw createError("Session is already linked to a milestone", 409);
    }

    // Validate prerequisite requirements for milestone sessions
    if (sessionType === 'milestone') {
      const prerequisitesMet = await this.validatePrerequisites(milestoneId, userId);
      if (!prerequisitesMet) {
        throw createError("Prerequisites not met for this milestone", 403);
      }
    }

    const { rows } = await pool.query<SessionMilestoneMapping>(
      `INSERT INTO milestone_sessions (milestone_id, booking_id, session_type, contributes_to_completion)
       VALUES ($1, $2, $3, $4)
       RETURNING id, milestone_id as "milestoneId", booking_id as "bookingId", 
                 session_type as "sessionType", contributes_to_completion as "contributesToCompletion",
                 created_at as "createdAt"`,
      [milestoneId, bookingId, sessionType, contributesToCompletion]
    );

    const mapping = rows[0];

    // Invalidate relevant caches
    await this.invalidateSessionCaches(milestoneId, userId);

    logger.info("Session linked to milestone", {
      milestoneId,
      bookingId,
      sessionType,
      userId
    });

    return mapping;
  },

  /**
   * Remove association between session and milestone
   */
  async unlinkSessionFromMilestone(
    bookingId: string,
    userId: string
  ): Promise<void> {
    // Get existing mapping to validate access
    const mapping = await this.getMappingByBookingId(bookingId);
    if (!mapping) {
      throw createError("Session is not linked to any milestone", 404);
    }

    // Validate user has access to the milestone
    await this.validateMilestoneAccess(mapping.milestoneId, userId);

    await pool.query(
      `DELETE FROM milestone_sessions WHERE booking_id = $1`,
      [bookingId]
    );

    // Invalidate relevant caches
    await this.invalidateSessionCaches(mapping.milestoneId, userId);

    logger.info("Session unlinked from milestone", {
      milestoneId: mapping.milestoneId,
      bookingId,
      userId
    });
  },

  /**
   * Get session context for a booking (milestone information)
   */
  async getSessionContext(
    bookingId: string,
    userId: string
  ): Promise<SessionMilestoneContext | null> {
    const cacheKey = CacheKeys.sessionContext(bookingId);
    
    // Try cache first
    const cached = await CacheService.get<SessionMilestoneContext>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    const { rows } = await pool.query(
      `SELECT 
         ms.milestone_id,
         m.title as milestone_title,
         m.learning_objectives,
         m.completion_criteria,
         ms.session_type,
         COALESCE(mp.progress_percentage, 0) as current_progress
       FROM milestone_sessions ms
       JOIN milestones m ON ms.milestone_id = m.id
       JOIN learning_paths lp ON m.learning_path_id = lp.id
       LEFT JOIN path_enrollments pe ON lp.id = pe.learning_path_id AND pe.student_id = $2
       LEFT JOIN milestone_progress mp ON ms.milestone_id = mp.milestone_id AND mp.enrollment_id = pe.id
       WHERE ms.booking_id = $1`,
      [bookingId, userId]
    );

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
    
    // Check prerequisites
    const prerequisitesMet = await this.validatePrerequisites(row.milestone_id, userId);

    const context: SessionMilestoneContext = {
      milestoneId: row.milestone_id,
      milestoneTitle: row.milestone_title,
      learningObjectives: row.learning_objectives || [],
      completionCriteria: row.completion_criteria || {},
      currentProgress: parseFloat(row.current_progress) || 0,
      prerequisitesMet,
      sessionType: row.session_type
    };

    // Cache for 5 minutes
    await CacheService.set(cacheKey, context, CacheTTL.short);

    return context;
  },

  /**
   * Get available sessions for a milestone
   */
  async getAvailableSessionsForMilestone(
    milestoneId: string,
    userId: string
  ): Promise<AvailableSession[]> {
    // Validate milestone access
    await this.validateMilestoneAccess(milestoneId, userId);

    // Get milestone details
    const { rows: milestoneRows } = await pool.query(
      `SELECT m.*, lp.mentor_id
       FROM milestones m
       JOIN learning_paths lp ON m.learning_path_id = lp.id
       WHERE m.id = $1`,
      [milestoneId]
    );

    if (milestoneRows.length === 0) {
      throw createError("Milestone not found", 404);
    }

    const milestone = milestoneRows[0];
    const prerequisitesMet = await this.validatePrerequisites(milestoneId, userId);

    // Define available session types based on milestone
    const availableSessions: AvailableSession[] = [
      {
        sessionType: 'milestone',
        title: `${milestone.title} - Core Session`,
        description: `Work on the main objectives of ${milestone.title}`,
        estimatedDuration: milestone.estimated_duration_hours * 60,
        isRecommended: true,
        prerequisitesMet
      },
      {
        sessionType: 'support',
        title: `${milestone.title} - Support Session`,
        description: `Get additional help and clarification for ${milestone.title}`,
        estimatedDuration: 60,
        isRecommended: false,
        prerequisitesMet: true // Support sessions don't require prerequisites
      }
    ];

    // Add assessment session if milestone has assessment criteria
    const completionCriteria = milestone.completion_criteria || {};
    if (completionCriteria.type === 'assessment' || completionCriteria.type === 'project') {
      availableSessions.push({
        sessionType: 'assessment',
        title: `${milestone.title} - Assessment Session`,
        description: `Assessment and evaluation for ${milestone.title}`,
        estimatedDuration: 90,
        isRecommended: prerequisitesMet,
        prerequisitesMet
      });
    }

    return availableSessions;
  },

  /**
   * Get sessions linked to a milestone
   */
  async getSessionsForMilestone(
    milestoneId: string,
    userId: string
  ): Promise<Array<SessionMilestoneMapping & { booking: BookingRecord }>> {
    // Validate milestone access
    await this.validateMilestoneAccess(milestoneId, userId);

    const { rows } = await pool.query(
      `SELECT 
         ms.id,
         ms.milestone_id as "milestoneId",
         ms.booking_id as "bookingId",
         ms.session_type as "sessionType",
         ms.contributes_to_completion as "contributesToCompletion",
         ms.created_at as "createdAt",
         b.*
       FROM milestone_sessions ms
       JOIN bookings b ON ms.booking_id = b.id
       WHERE ms.milestone_id = $1
       ORDER BY b.scheduled_at DESC`,
      [milestoneId]
    );

    return rows.map(row => ({
      id: row.id,
      milestoneId: row.milestoneId,
      bookingId: row.bookingId,
      sessionType: row.sessionType,
      contributesToCompletion: row.contributesToCompletion,
      createdAt: row.createdAt,
      booking: {
        id: row.id,
        mentee_id: row.mentee_id,
        mentor_id: row.mentor_id,
        scheduled_at: row.scheduled_at,
        duration_minutes: row.duration_minutes,
        topic: row.topic,
        notes: row.notes,
        status: row.status,
        amount: row.amount,
        currency: row.currency,
        payment_status: row.payment_status,
        stellar_tx_hash: row.stellar_tx_hash,
        transaction_id: row.transaction_id,
        cancellation_reason: row.cancellation_reason,
        created_at: row.created_at,
        updated_at: row.updated_at
      }
    }));
  },

  /**
   * Get milestone information for a session
   */
  async getMilestoneForSession(
    bookingId: string
  ): Promise<SessionMilestoneMapping | null> {
    return this.getMappingByBookingId(bookingId);
  },

  /**
   * Update session type or contribution setting
   */
  async updateSessionMapping(
    bookingId: string,
    updates: {
      sessionType?: 'milestone' | 'support' | 'assessment';
      contributesToCompletion?: boolean;
    },
    userId: string
  ): Promise<SessionMilestoneMapping> {
    const mapping = await this.getMappingByBookingId(bookingId);
    if (!mapping) {
      throw createError("Session is not linked to any milestone", 404);
    }

    // Validate user has access to the milestone
    await this.validateMilestoneAccess(mapping.milestoneId, userId);

    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (updates.sessionType !== undefined) {
      fields.push(`session_type = $${idx++}`);
      values.push(updates.sessionType);
    }

    if (updates.contributesToCompletion !== undefined) {
      fields.push(`contributes_to_completion = $${idx++}`);
      values.push(updates.contributesToCompletion);
    }

    if (fields.length === 0) {
      return mapping;
    }

    values.push(bookingId);

    const { rows } = await pool.query<SessionMilestoneMapping>(
      `UPDATE milestone_sessions 
       SET ${fields.join(', ')}
       WHERE booking_id = $${idx}
       RETURNING id, milestone_id as "milestoneId", booking_id as "bookingId", 
                 session_type as "sessionType", contributes_to_completion as "contributesToCompletion",
                 created_at as "createdAt"`,
      values
    );

    const updated = rows[0];

    // Invalidate relevant caches
    await this.invalidateSessionCaches(mapping.milestoneId, userId);

    logger.info("Session mapping updated", {
      bookingId,
      updates,
      userId
    });

    return updated;
  },

  /**
   * Get sessions that contribute to milestone completion
   */
  async getCompletionContributingSessions(
    milestoneId: string,
    userId: string
  ): Promise<SessionMilestoneMapping[]> {
    // Validate milestone access
    await this.validateMilestoneAccess(milestoneId, userId);

    const { rows } = await pool.query<SessionMilestoneMapping>(
      `SELECT 
         id,
         milestone_id as "milestoneId",
         booking_id as "bookingId",
         session_type as "sessionType",
         contributes_to_completion as "contributesToCompletion",
         created_at as "createdAt"
       FROM milestone_sessions
       WHERE milestone_id = $1 AND contributes_to_completion = true`,
      [milestoneId]
    );

    return rows;
  },

  // Private helper methods

  private async getMappingByBookingId(bookingId: string): Promise<SessionMilestoneMapping | null> {
    const { rows } = await pool.query<SessionMilestoneMapping>(
      `SELECT 
         id,
         milestone_id as "milestoneId",
         booking_id as "bookingId",
         session_type as "sessionType",
         contributes_to_completion as "contributesToCompletion",
         created_at as "createdAt"
       FROM milestone_sessions
       WHERE booking_id = $1`,
      [bookingId]
    );

    return rows[0] || null;
  },

  private async validateMilestoneAccess(milestoneId: string, userId: string): Promise<any> {
    const { rows } = await pool.query(
      `SELECT m.*, lp.mentor_id, pe.student_id
       FROM milestones m
       JOIN learning_paths lp ON m.learning_path_id = lp.id
       LEFT JOIN path_enrollments pe ON lp.id = pe.learning_path_id AND pe.student_id = $2
       WHERE m.id = $1`,
      [milestoneId, userId]
    );

    if (rows.length === 0) {
      throw createError("Milestone not found", 404);
    }

    const milestone = rows[0];
    
    // Check if user is mentor or enrolled student
    if (milestone.mentor_id !== userId && milestone.student_id !== userId) {
      throw createError("Access denied to this milestone", 403);
    }

    return milestone;
  },

  private async validateBookingAccess(bookingId: string, userId: string): Promise<BookingRecord> {
    const { rows } = await pool.query<BookingRecord>(
      `SELECT * FROM bookings WHERE id = $1`,
      [bookingId]
    );

    if (rows.length === 0) {
      throw createError("Booking not found", 404);
    }

    const booking = rows[0];

    // Check if user is mentee or mentor
    if (booking.mentee_id !== userId && booking.mentor_id !== userId) {
      throw createError("Access denied to this booking", 403);
    }

    return booking;
  },

  private async validatePrerequisites(milestoneId: string, userId: string): Promise<boolean> {
    // Import here to avoid circular dependency
    const { PrerequisiteValidatorService } = await import("./prerequisite-validator.service");
    
    try {
      const result = await PrerequisiteValidatorService.validatePrerequisites(userId, milestoneId);
      return result.isValid;
    } catch (error) {
      logger.warn("Error validating prerequisites", { milestoneId, userId, error });
      return false;
    }
  },

  private async invalidateSessionCaches(milestoneId: string, userId: string): Promise<void> {
    const cacheKeys = [
      CacheKeys.milestoneProgress(milestoneId),
      CacheKeys.studentProgress(userId),
      CacheKeys.sessionList(userId)
    ];

    await Promise.all(cacheKeys.map(key => CacheService.del(key)));
  }
};