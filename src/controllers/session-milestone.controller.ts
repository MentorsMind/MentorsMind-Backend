import { Request, Response } from "express";
import { z } from "zod";
import { SessionMilestoneService } from "../services/session-milestone.service";
import { ContextualBookingService } from "../services/contextual-booking.service";
import { SessionOutcomeService } from "../services/session-outcome.service";
import { BookingCompatibilityService } from "../services/booking-compatibility.service";
import { logger } from "../utils/logger.utils";
import { createError } from "../middleware/errorHandler";

// Validation schemas
const LinkSessionSchema = z.object({
  milestoneId: z.string().uuid(),
  sessionType: z.enum(['milestone', 'support', 'assessment']).default('milestone'),
  contributesToCompletion: z.boolean().default(true)
});

const UpdateMappingSchema = z.object({
  sessionType: z.enum(['milestone', 'support', 'assessment']).optional(),
  contributesToCompletion: z.boolean().optional()
});

const CreateOutcomeSchema = z.object({
  mentorFeedback: z.string().optional(),
  studentFeedback: z.string().optional(),
  objectivesAchieved: z.array(z.string()).optional(),
  skillsImproved: z.array(z.string()).optional(),
  nextSteps: z.array(z.string()).optional(),
  progressContribution: z.number().min(0).max(100).optional(),
  completionStatus: z.enum(['not_started', 'in_progress', 'completed', 'needs_review']).optional(),
  sessionEffectiveness: z.number().min(1).max(5).optional(),
  recommendedFollowUp: z.enum(['continue', 'assessment', 'support', 'complete']).optional()
});

const ContextualBookingSchema = z.object({
  menteeId: z.string().uuid(),
  mentorId: z.string().uuid(),
  scheduledAt: z.string().datetime(),
  durationMinutes: z.number().min(15).max(240),
  topic: z.string().min(1).max(500),
  notes: z.string().optional(),
  milestoneId: z.string().uuid().optional(),
  sessionType: z.enum(['milestone', 'support', 'assessment']).optional(),
  contributesToCompletion: z.boolean().optional()
});

export const SessionMilestoneController = {
  /**
   * Link a session to a milestone
   * POST /api/v1/sessions/:bookingId/milestone
   */
  async linkSessionToMilestone(req: Request, res: Response): Promise<void> {
    try {
      const { bookingId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        throw createError("Authentication required", 401);
      }

      const validatedData = LinkSessionSchema.parse(req.body);

      const mapping = await SessionMilestoneService.linkSessionToMilestone(
        validatedData.milestoneId,
        bookingId,
        validatedData.sessionType,
        validatedData.contributesToCompletion,
        userId
      );

      logger.info("Session linked to milestone", {
        bookingId,
        milestoneId: validatedData.milestoneId,
        userId
      });

      res.status(201).json({
        success: true,
        data: mapping
      });
    } catch (error) {
      logger.error("Error linking session to milestone", { error, bookingId: req.params.bookingId });
      throw error;
    }
  },

  /**
   * Unlink a session from milestone
   * DELETE /api/v1/sessions/:bookingId/milestone
   */
  async unlinkSessionFromMilestone(req: Request, res: Response): Promise<void> {
    try {
      const { bookingId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        throw createError("Authentication required", 401);
      }

      await SessionMilestoneService.unlinkSessionFromMilestone(bookingId, userId);

      logger.info("Session unlinked from milestone", { bookingId, userId });

      res.json({
        success: true,
        message: "Session unlinked from milestone"
      });
    } catch (error) {
      logger.error("Error unlinking session from milestone", { error, bookingId: req.params.bookingId });
      throw error;
    }
  },

  /**
   * Get session context (milestone information)
   * GET /api/v1/sessions/:bookingId/context
   */
  async getSessionContext(req: Request, res: Response): Promise<void> {
    try {
      const { bookingId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        throw createError("Authentication required", 401);
      }

      const context = await SessionMilestoneService.getSessionContext(bookingId, userId);

      res.json({
        success: true,
        data: context
      });
    } catch (error) {
      logger.error("Error getting session context", { error, bookingId: req.params.bookingId });
      throw error;
    }
  },

  /**
   * Get available sessions for a milestone
   * GET /api/v1/milestones/:milestoneId/sessions/available
   */
  async getAvailableSessionsForMilestone(req: Request, res: Response): Promise<void> {
    try {
      const { milestoneId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        throw createError("Authentication required", 401);
      }

      const sessions = await SessionMilestoneService.getAvailableSessionsForMilestone(
        milestoneId,
        userId
      );

      res.json({
        success: true,
        data: sessions
      });
    } catch (error) {
      logger.error("Error getting available sessions", { error, milestoneId: req.params.milestoneId });
      throw error;
    }
  },

  /**
   * Get sessions linked to a milestone
   * GET /api/v1/milestones/:milestoneId/sessions
   */
  async getSessionsForMilestone(req: Request, res: Response): Promise<void> {
    try {
      const { milestoneId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        throw createError("Authentication required", 401);
      }

      const sessions = await SessionMilestoneService.getSessionsForMilestone(milestoneId, userId);

      res.json({
        success: true,
        data: sessions
      });
    } catch (error) {
      logger.error("Error getting milestone sessions", { error, milestoneId: req.params.milestoneId });
      throw error;
    }
  },

  /**
   * Update session mapping
   * PATCH /api/v1/sessions/:bookingId/milestone
   */
  async updateSessionMapping(req: Request, res: Response): Promise<void> {
    try {
      const { bookingId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        throw createError("Authentication required", 401);
      }

      const validatedData = UpdateMappingSchema.parse(req.body);

      const mapping = await SessionMilestoneService.updateSessionMapping(
        bookingId,
        validatedData,
        userId
      );

      logger.info("Session mapping updated", { bookingId, updates: validatedData, userId });

      res.json({
        success: true,
        data: mapping
      });
    } catch (error) {
      logger.error("Error updating session mapping", { error, bookingId: req.params.bookingId });
      throw error;
    }
  },

  /**
   * Create contextual booking with learning path integration
   * POST /api/v1/bookings/contextual
   */
  async createContextualBooking(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;

      if (!userId) {
        throw createError("Authentication required", 401);
      }

      const validatedData = ContextualBookingSchema.parse(req.body);

      // Verify user is either mentor or mentee
      if (validatedData.mentorId !== userId && validatedData.menteeId !== userId) {
        throw createError("Access denied", 403);
      }

      const result = await ContextualBookingService.createContextualBooking({
        ...validatedData,
        scheduledAt: new Date(validatedData.scheduledAt)
      });

      logger.info("Contextual booking created", {
        bookingId: result.booking.id,
        milestoneId: validatedData.milestoneId,
        userId
      });

      res.status(201).json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error("Error creating contextual booking", { error });
      throw error;
    }
  },

  /**
   * Get learning path context for booking
   * GET /api/v1/bookings/context/:mentorId/:studentId
   */
  async getLearningPathContext(req: Request, res: Response): Promise<void> {
    try {
      const { mentorId, studentId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        throw createError("Authentication required", 401);
      }

      // Verify user is either mentor or student
      if (mentorId !== userId && studentId !== userId) {
        throw createError("Access denied", 403);
      }

      const contexts = await ContextualBookingService.getLearningPathContext(mentorId, studentId);

      res.json({
        success: true,
        data: contexts
      });
    } catch (error) {
      logger.error("Error getting learning path context", { error });
      throw error;
    }
  },

  /**
   * Get booking recommendations
   * GET /api/v1/bookings/recommendations/:mentorId/:studentId
   */
  async getBookingRecommendations(req: Request, res: Response): Promise<void> {
    try {
      const { mentorId, studentId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        throw createError("Authentication required", 401);
      }

      // Verify user is either mentor or student
      if (mentorId !== userId && studentId !== userId) {
        throw createError("Access denied", 403);
      }

      const recommendations = await ContextualBookingService.getBookingRecommendations(
        mentorId,
        studentId
      );

      res.json({
        success: true,
        data: recommendations
      });
    } catch (error) {
      logger.error("Error getting booking recommendations", { error });
      throw error;
    }
  },

  /**
   * Create session outcome
   * POST /api/v1/sessions/:bookingId/outcome
   */
  async createSessionOutcome(req: Request, res: Response): Promise<void> {
    try {
      const { bookingId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        throw createError("Authentication required", 401);
      }

      const validatedData = CreateOutcomeSchema.parse(req.body);

      const outcome = await SessionOutcomeService.createSessionOutcome(
        { ...validatedData, bookingId },
        userId
      );

      logger.info("Session outcome created", { bookingId, userId });

      res.status(201).json({
        success: true,
        data: outcome
      });
    } catch (error) {
      logger.error("Error creating session outcome", { error, bookingId: req.params.bookingId });
      throw error;
    }
  },

  /**
   * Get session outcome
   * GET /api/v1/sessions/:bookingId/outcome
   */
  async getSessionOutcome(req: Request, res: Response): Promise<void> {
    try {
      const { bookingId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        throw createError("Authentication required", 401);
      }

      const outcome = await SessionOutcomeService.getSessionOutcomeByBooking(bookingId, userId);

      res.json({
        success: true,
        data: outcome
      });
    } catch (error) {
      logger.error("Error getting session outcome", { error, bookingId: req.params.bookingId });
      throw error;
    }
  },

  /**
   * Analyze session impact
   * GET /api/v1/sessions/:bookingId/impact
   */
  async analyzeSessionImpact(req: Request, res: Response): Promise<void> {
    try {
      const { bookingId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        throw createError("Authentication required", 401);
      }

      const analysis = await SessionOutcomeService.analyzeSessionImpact(bookingId, userId);

      res.json({
        success: true,
        data: analysis
      });
    } catch (error) {
      logger.error("Error analyzing session impact", { error, bookingId: req.params.bookingId });
      throw error;
    }
  },

  /**
   * Get hybrid mode configuration
   * GET /api/v1/mentors/:mentorId/hybrid-config
   */
  async getHybridModeConfig(req: Request, res: Response): Promise<void> {
    try {
      const { mentorId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        throw createError("Authentication required", 401);
      }

      // Only mentor can view their own config
      if (mentorId !== userId) {
        throw createError("Access denied", 403);
      }

      const config = await BookingCompatibilityService.getHybridModeConfig(mentorId);

      res.json({
        success: true,
        data: config
      });
    } catch (error) {
      logger.error("Error getting hybrid mode config", { error, mentorId: req.params.mentorId });
      throw error;
    }
  },

  /**
   * Update hybrid mode configuration
   * PATCH /api/v1/mentors/:mentorId/hybrid-config
   */
  async updateHybridModeConfig(req: Request, res: Response): Promise<void> {
    try {
      const { mentorId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        throw createError("Authentication required", 401);
      }

      // Only mentor can update their own config
      if (mentorId !== userId) {
        throw createError("Access denied", 403);
      }

      const configSchema = z.object({
        learningPathsEnabled: z.boolean().optional(),
        individualSessionsEnabled: z.boolean().optional(),
        autoLinkSessions: z.boolean().optional(),
        defaultSessionType: z.enum(['milestone', 'support', 'assessment']).optional()
      });

      const validatedData = configSchema.parse(req.body);

      const config = await BookingCompatibilityService.updateHybridModeConfig(
        mentorId,
        validatedData
      );

      logger.info("Hybrid mode config updated", { mentorId, updates: validatedData });

      res.json({
        success: true,
        data: config
      });
    } catch (error) {
      logger.error("Error updating hybrid mode config", { error, mentorId: req.params.mentorId });
      throw error;
    }
  },

  /**
   * Get booking options for mentor-student pair
   * GET /api/v1/bookings/options/:mentorId/:studentId
   */
  async getBookingOptions(req: Request, res: Response): Promise<void> {
    try {
      const { mentorId, studentId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        throw createError("Authentication required", 401);
      }

      // Verify user is either mentor or student
      if (mentorId !== userId && studentId !== userId) {
        throw createError("Access denied", 403);
      }

      const options = await BookingCompatibilityService.getBookingOptions(mentorId, studentId);

      res.json({
        success: true,
        data: options
      });
    } catch (error) {
      logger.error("Error getting booking options", { error });
      throw error;
    }
  }
};