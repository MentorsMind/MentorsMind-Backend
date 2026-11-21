import { Request, Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import { SessionModel } from "../models/session.model";
import { BookingModel } from "../models/booking.model";
import { UsersService } from "../services/users.service";
import { MeetingService } from "../services/meeting.service";
import { NotificationService } from "../services/notification.service";
import { BookingsService } from "../services/bookings.service";
import { EventStoreService } from "../services/event-store.service";
import { ResponseUtil } from "../utils/response.utils";
import { asyncHandler } from "../utils/asyncHandler.utils";
import { Logger, logger } from "../utils/logger.utils";

/** Maximum number of days in advance a booking may be scheduled. */
const MAX_BOOKING_HORIZON_DAYS = 365;

/**
 * Parses and validates a user-supplied scheduledAt value.
 * Returns a valid Date or an error message.
 */
function parseScheduledAt(
  value: unknown,
): { date: Date } | { error: string } {
  if (value === undefined || value === null || value === "") {
    return { error: "scheduledAt is required" };
  }
  if (typeof value !== "string" && typeof value !== "number") {
    return { error: "scheduledAt must be a valid date string" };
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { error: "scheduledAt is not a valid date" };
  }

  const now = Date.now();
  if (date.getTime() <= now) {
    return { error: "scheduledAt must be in the future" };
  }

  const maxMs = MAX_BOOKING_HORIZON_DAYS * 24 * 60 * 60 * 1000;
  if (date.getTime() - now > maxMs) {
    return {
      error: `scheduledAt must be within ${MAX_BOOKING_HORIZON_DAYS} days from now`,
    };
  }

  return { date };
}

/**
 * Bookings Controller - Handles session booking operations with meeting URL generation
 */
export const BookingsController = {
  /**
   * Create a new booking
   * POST /api/v1/bookings
   */
  createBooking: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { mentorId, scheduledAt, durationMinutes, topic, notes } = req.body;
    const menteeId = req.user?.id ?? req.user?.userId;

    if (!menteeId) {
      return ResponseUtil.unauthorized(res, "Authentication required");
    }

    const parsed = parseScheduledAt(scheduledAt);
    if ("error" in parsed) {
      return ResponseUtil.error(res, parsed.error, 400);
    }

    const bookingData = {
      menteeId,
      mentorId,
      scheduledAt: parsed.date,
      durationMinutes,
      topic,
      notes,
    };

    const booking = await BookingsService.createBooking(bookingData);
    
    return ResponseUtil.created(res, { booking }, 'Booking created successfully');
  }),

  /**
   * Confirm a booking and generate meeting URL
   * POST /api/v1/bookings/:id/confirm
   */
  confirmBooking: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!id || Array.isArray(id)) {
      return ResponseUtil.error(res, "Invalid session ID", 400);
    }

    const userId = (req as AuthenticatedRequest).user?.id ?? (req as AuthenticatedRequest).user?.userId;

    // Check if this ID refers to a booking in the bookings table
    const booking = await BookingModel.findById(id);
    if (booking) {
      if (!userId) {
        return ResponseUtil.unauthorized(res, "Authentication required");
      }
      const confirmed = await BookingsService.confirmBooking(id, userId);
      return ResponseUtil.success(
        res,
        { booking: confirmed, session: confirmed },
        "Booking confirmed successfully",
      );
    }

    // Find the session in sessions table
    const session = await SessionModel.findById(id);

    if (!session) {
      return ResponseUtil.error(res, "Session not found", 404);
    }

    // Check if already confirmed
    if (session.status === "confirmed") {
      return ResponseUtil.error(res, "Session is already confirmed", 400);
    }

    // Get mentor and mentee details
    const [mentor, mentee] = await Promise.all([
      (UsersService as any).findById(session.mentor_id),
      (UsersService as any).findById(session.mentee_id),
    ]);

    if (!mentor || !mentee) {
      return ResponseUtil.error(res, "Invalid participant information", 400);
    }

    try {
      // Generate meeting URL
      const meetingResult = await MeetingService.createMeetingRoom({
        sessionId: session.id,
        scheduledAt: session.scheduled_at,
        durationMinutes: session.duration_minutes,
        mentorName: `${mentor.first_name} ${mentor.last_name}`,
        menteeName: `${mentee.first_name} ${mentee.last_name}`,
      });

      // Update session with meeting URL
      const updatedSession = await SessionModel.updateMeetingUrl(session.id, {
        meetingUrl: meetingResult.meetingUrl,
        meetingProvider: meetingResult.provider,
        meetingRoomId: meetingResult.roomId,
        meetingExpiresAt: meetingResult.expiresAt,
      });

      if (!updatedSession) {
        throw new Error("Failed to update session with meeting URL");
      }

      // Update session status to confirmed
      await SessionModel.updateStatus(session.id, "confirmed");

      // Send notifications to both participants
      try {
        await NotificationService.sendMeetingUrlNotification(
          mentor.id,
          mentee.id,
          mentor.email,
          mentee.email,
          `${mentor.first_name} ${mentor.last_name}`,
          `${mentee.first_name} ${mentee.last_name}`,
          meetingResult.meetingUrl,
          session.scheduled_at,
          session.duration_minutes,
          meetingResult.expiresAt,
        );
      } catch (notificationError) {
        // Log notification error but don't fail the booking
        logger.error(
          "Failed to send meeting notifications:",
          notificationError,
        );
      }

      // Return updated session with meeting URL
      ResponseUtil.success(
        res,
        {
          session: {
            ...updatedSession,
            meeting_url: updatedSession.meeting_url,
            meeting_provider: updatedSession.meeting_provider,
            meeting_expires_at: updatedSession.meeting_expires_at,
          },
        },
        "Booking confirmed and meeting room created successfully",
      );
    } catch (error) {
      // Handle meeting creation failure
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      // Mark session for manual intervention
      await SessionModel.markForManualIntervention(session.id);

      logger.error("Failed to create meeting room:", errorMessage);

      // Still confirm the booking but flag the issue
      await SessionModel.updateStatus(session.id, "confirmed");

      ResponseUtil.success(
        res,
        {
          session: await SessionModel.findById(session.id),
          warning:
            "Meeting room creation failed. Manual intervention required.",
          details: errorMessage,
        },
        "Booking confirmed but meeting URL could not be generated",
        200,
      );
    }
  }),

  /**
   * Get session details with meeting URL (if confirmed)
   * GET /api/v1/bookings/:id
   */
  getSession: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    if (Array.isArray(id)) {
      return ResponseUtil.error(res, "Invalid session ID", 400);
    }

    const session = await SessionModel.findById(id);

    if (!session) {
      return ResponseUtil.error(res, "Session not found", 404);
    }

    // Only include meeting URL if session is confirmed
    const sessionData = {
      ...session,
      // Hide meeting details if not confirmed
      meeting_url: session.status === "confirmed" ? session.meeting_url : null,
      meeting_provider:
        session.status === "confirmed" ? session.meeting_provider : null,
      meeting_expires_at:
        session.status === "confirmed" ? session.meeting_expires_at : null,
      meeting_room_id:
        session.status === "confirmed" ? session.meeting_room_id : null,
    };

    ResponseUtil.success(res, { session: sessionData });
  }),

  /**
   * List user's sessions
   * GET /api/v1/bookings
   */
  listBookings: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id ?? req.user?.userId;

    if (!userId) {
      return ResponseUtil.error(res, "Unauthorized", 401);
    }

    const { upcoming, cursor, limit: limitQuery, page: pageQuery, status } = req.query as any;
    const page = pageQuery ? parseInt(pageQuery, 10) : 1;
    const limit = limitQuery ? parseInt(limitQuery, 10) : 20;

    // We only support cursor pagination for the main list for now as per standardization requirements
    if (upcoming === "true") {
      const sessions = await SessionModel.findUpcomingByUserId(userId);
      const sessionsData = sessions.map((session) => ({
        ...session,
        meeting_url: session.status === "confirmed" ? session.meeting_url : null,
        meeting_provider: session.status === "confirmed" ? session.meeting_provider : null,
        meeting_expires_at: session.status === "confirmed" ? session.meeting_expires_at : null,
      }));
      return ResponseUtil.success(res, { data: sessionsData });
    }

    const { bookings, total } = await BookingsService.listBookings(userId, {
      status,
      cursor,
      page,
      limit,
    });

    const sessionsData = bookings.map((session: any) => ({
      ...session,
      meeting_url: session.status === "confirmed" ? session.meeting_url : null,
      meeting_provider: session.status === "confirmed" ? session.meeting_provider : null,
      meeting_expires_at: session.status === "confirmed" ? session.meeting_expires_at : null,
    }));

    const totalPages = Math.ceil(total / limit) || 1;
    const meta = {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    };

    ResponseUtil.success(
      res,
      sessionsData,
      "Bookings retrieved successfully",
      200,
      meta,
    );
  }),

  /**
   * Cancel a booking
   * DELETE /api/v1/bookings/:id/cancel
   */
  cancelBooking: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    if (Array.isArray(id)) {
      return ResponseUtil.error(res, "Invalid session ID", 400);
    }

    const session = await SessionModel.findById(id);

    if (!session) {
      return ResponseUtil.error(res, "Session not found", 404);
    }

    // Can only cancel pending or confirmed sessions
    if (!["pending", "confirmed"].includes(session.status)) {
      return ResponseUtil.error(res, "Cannot cancel this session", 400);
    }

    await SessionModel.updateStatus(id, "cancelled");

    ResponseUtil.success(res, { message: "Booking cancelled successfully" });
  }),

  /**
   * Get sessions requiring manual intervention
   * GET /api/v1/bookings/manual-intervention
   * (Admin-only endpoint)
   */
  getManualInterventionSessions: asyncHandler(
    async (_req: Request, res: Response) => {
      const sessions = await SessionModel.findNeedingManualIntervention();

      ResponseUtil.success(
        res,
        { sessions },
        "Sessions requiring manual meeting setup",
      );
    },
  ),

  /**
   * GET /api/v1/bookings/:id/events
   * Admin-only full event log for a booking aggregate (version order).
   */
  getBookingEvents: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id || Array.isArray(id)) {
      return ResponseUtil.error(res, "Invalid booking ID", 400);
    }

    const limit = Math.min(parseInt(String(req.query.limit || "100"), 10) || 100, 500);
    const offset = parseInt(String(req.query.offset || "0"), 10) || 0;

    const history = await EventStoreService.getEventHistory(id, limit, offset);

    return ResponseUtil.success(
      res,
      {
        bookingId: id,
        events: history,
      },
    );
  }),
};
