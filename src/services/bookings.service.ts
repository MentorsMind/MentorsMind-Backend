import { BookingModel, BookingRecord } from "../models/booking.model";
import { CacheService } from "./cache.service";
import { CacheKeys, CacheTTL } from "../utils/cache-key.utils";
import { logger } from "../utils/logger.utils";
import { createError } from "../middleware/errorHandler";
import { ErrorCode } from "../errors/error-codes";
import {
  calculateEndTime,
  calculateRefundEligibility,
} from "../utils/booking-conflicts.utils";
import { SocketService } from "./socket.service";
import { db } from "../config/database";
import { CalendarService } from "./calendar.service";
import { SorobanEscrowService } from "./sorobanEscrow.service";
import { AssetExchangeService } from "./assetExchange.service";
import { QueueService } from "./queue.service";
import {
  NotificationService,
  NotificationChannel,
  NotificationPriority,
} from "./notification.service";
import { NotificationType } from "../models/notifications.model";
import { SessionSummaryModel } from "../models/session-summary.model";
import { MentorsService } from "./mentors.service";
import { LoyaltyService } from "./loyalty.service";
import { scheduleNoShowCheck } from "../queues/session-no-show.queue";
import config from "../config";
import { EventStoreService } from "./event-store.service";
import {
  BOOKING_AGGREGATE_TYPE,
  BookingProjectionEventType,
} from "../events/booking.reducer";

/** Dual-write helper — never fails the primary booking mutation. */
async function publishBookingDomainEvent(
  bookingId: string,
  eventType: string,
  data: Record<string, unknown>,
  userId: string,
): Promise<void> {
  try {
    await EventStoreService.publishEvent(
      bookingId,
      BOOKING_AGGREGATE_TYPE,
      eventType,
      data,
      { userId },
    );
  } catch (error) {
    logger.warn("Booking event dual-write failed (non-fatal)", {
      bookingId,
      eventType,
      error: error instanceof Error ? error.message : error,
    });
  }
}

export interface CreateBookingData {
  menteeId: string;
  mentorId: string;
  scheduledAt: Date;
  durationMinutes: number;
  topic: string;
  notes?: string;
}

export interface UpdateBookingData {
  scheduledAt?: Date;
  durationMinutes?: number;
  topic?: string;
  notes?: string;
}

interface BookingEscrowMetadata {
  escrow_id: string | null;
  escrow_contract_address: string | null;
}

async function getBookingEscrowMetadata(
  bookingId: string,
): Promise<BookingEscrowMetadata> {
  const { rows } = await db.query(
    `SELECT escrow_id, escrow_contract_address FROM bookings WHERE id = $1`,
    [bookingId],
  );

  return (
    rows[0] || {
      escrow_id: null,
      escrow_contract_address: null,
    }
  );
}

async function setBookingEscrowMetadata(
  bookingId: string,
  contractAddress: string,
  escrowId: string,
  txHash: string | null,
): Promise<void> {
  await db.query(
    `UPDATE bookings
     SET escrow_contract_address = $2,
         escrow_id = $3,
         stellar_tx_hash = COALESCE($4, stellar_tx_hash),
         updated_at = NOW()
     WHERE id = $1`,
    [bookingId, contractAddress, escrowId, txHash],
  );
}

function isCancelledBeforeSession(booking: BookingRecord): boolean {
  return booking.scheduled_at > new Date();
}

export const BookingsService = {
  /**
   * Initialize bookings service (starts background monitoring only).
   * Table schema is managed by migrations, not runtime DDL.
   */
  async initialize(): Promise<void> {
    // Start pending escrow monitoring (background job)
    SorobanEscrowService.startPendingEscrowMonitoring();
  },

  async createBooking(data: CreateBookingData): Promise<BookingRecord> {
    // Batch-validate both users in a single query (avoids N+1)
    const { rows: users } = await db.query(
      `SELECT id, role, status FROM users WHERE id = ANY($1) AND is_active = true`,
      [[data.menteeId, data.mentorId]],
    );

    const mentee = users.find((u: any) => u.id === data.menteeId);
    const mentor = users.find((u: any) => u.id === data.mentorId);

    if (!mentee) {
      throw createError(ErrorCode.BOOKING_MENTEE_NOT_FOUND, 404);
    }
    if (!mentor) {
      throw createError(ErrorCode.BOOKING_MENTOR_NOT_FOUND, 404);
    }

    // Prevent suspended or banned users from booking
    if (mentee.status === "suspended") {
      throw createError(ErrorCode.BOOKING_USER_SUSPENDED, 403);
    }
    if (mentee.status === "banned") {
      throw createError(ErrorCode.BOOKING_USER_BANNED, 403);
    }
    if (mentor.status === "suspended" || mentor.status === "banned") {
      throw createError(ErrorCode.MENTOR_NOT_AVAILABLE, 400);
    }

    if (mentor.role !== "mentor") {
      throw createError(ErrorCode.BOOKING_USER_NOT_A_MENTOR, 400);
    }

    // Check for booking conflicts
    const hasConflict = await BookingModel.checkConflict(
      data.mentorId,
      data.scheduledAt,
      data.durationMinutes,
    );

    if (hasConflict) {
      throw createError(ErrorCode.BOOKING_CONFLICT, 409);
    }

    // Calculate amount from mentor profile
    const mentorProfile = await MentorsService.findById(data.mentorId);
    if (!mentorProfile || mentorProfile.hourly_rate === null) {
      throw createError(ErrorCode.BOOKING_MENTOR_PROFILE_NOT_FOUND, 404);
    }
    const hourlyRate = mentorProfile.hourly_rate;
    const amount = ((data.durationMinutes / 60) * hourlyRate).toFixed(7);

    // Best-effort USD equivalent (oracle preferred, SDEX fallback via
    // AssetExchangeService). Never blocks booking creation on failure.
    let usdEquivalent: string | null = null;
    try {
      const rate = await AssetExchangeService.getRate("XLM", "USDC");
      usdEquivalent = (parseFloat(amount) * parseFloat(rate.rate)).toFixed(2);
    } catch (error) {
      logger.warn("Failed to compute USD equivalent for booking amount", {
        mentorId: data.mentorId,
        error: error instanceof Error ? error.message : error,
      });
    }

    // Create booking
    const booking = await BookingModel.create({
      menteeId: data.menteeId,
      mentorId: data.mentorId,
      scheduledAt: data.scheduledAt,
      durationMinutes: data.durationMinutes,
      topic: data.topic,
      notes: data.notes,
      amount,
      currency: "XLM",
      usdEquivalent,
    });

    // Dual-write: domain event alongside direct DB write (migration period)
    await publishBookingDomainEvent(
      booking.id,
      BookingProjectionEventType.BookingCreated,
      {
        menteeId: booking.mentee_id,
        mentorId: booking.mentor_id,
        scheduledAt: booking.scheduled_at,
        durationMinutes: booking.duration_minutes,
        topic: booking.topic,
        notes: booking.notes,
        amount: booking.amount,
        currency: booking.currency,
        status: booking.status,
        paymentStatus: booking.payment_status,
      },
      data.menteeId,
    );

    return booking;
  },

  async getBookingById(
    bookingId: string,
    userId: string,
  ): Promise<BookingRecord> {
    const booking = await BookingModel.findById(bookingId);

    if (!booking) {
      throw createError(ErrorCode.BOOKING_NOT_FOUND, 404);
    }

    // Verify user has access to this booking
    if (booking.mentee_id !== userId && booking.mentor_id !== userId) {
      throw createError(ErrorCode.AUTHZ_FORBIDDEN, 403);
    }

    return booking;
  },

  async getUserBookings(
    userId: string,
    filters?: { status?: string; cursor?: string; page?: number; limit?: number },
  ): Promise<{ bookings: BookingRecord[]; total: number }> {
    const cacheKey = CacheKeys.sessionList(userId);

    // Try to get from cache first
    const cached = await CacheService.get<{
      bookings: BookingRecord[];
      total: number;
    }>(cacheKey);
    if (cached !== null) {
      logger.debug("bookings.getUserBookings cache hit", { userId });
      return cached;
    }

    // Not in cache, fetch from database
    const result = await BookingModel.findByUserId(userId, filters);

    // Cache the result for 30 seconds
    await CacheService.set(cacheKey, result, CacheTTL.veryShort);

    return result;
  },

  async updateBooking(
    bookingId: string,
    userId: string,
    data: UpdateBookingData,
  ): Promise<BookingRecord> {
    const booking = await this.getBookingById(bookingId, userId);

    // Only allow updates if booking is pending or confirmed
    if (!["pending", "confirmed"].includes(booking.status)) {
      throw createError(ErrorCode.BOOKING_INVALID_STATUS, 400);
    }

    // Only mentee can update booking details
    if (booking.mentee_id !== userId) {
      throw createError(ErrorCode.BOOKING_ONLY_MENTEE_CAN_UPDATE, 403);
    }

    // If rescheduling, check for conflicts
    if (data.scheduledAt || data.durationMinutes) {
      const newScheduledAt = data.scheduledAt || booking.scheduled_at;
      const newDuration = data.durationMinutes || booking.duration_minutes;

      const hasConflict = await BookingModel.checkConflict(
        booking.mentor_id,
        newScheduledAt,
        newDuration,
        bookingId,
      );

      if (hasConflict) {
      throw createError(ErrorCode.BOOKING_CONFLICT, 409);
      }
    }

    const updated = await BookingModel.update(bookingId, {
      scheduledAt: data.scheduledAt,
      durationMinutes: data.durationMinutes,
      topic: data.topic,
      notes: data.notes,
    });

    if (!updated) {
      throw createError(ErrorCode.BOOKING_UPDATE_FAILED, 500);
    }

    // Invalidate session list cache for both mentee and mentor
    await CacheService.del(CacheKeys.sessionList(booking.mentee_id));
    await CacheService.del(CacheKeys.sessionList(booking.mentor_id));
    logger.debug("Booking cache invalidated on update", { bookingId });

    return updated;
  },

  async confirmBooking(
    bookingId: string,
    userId: string,
  ): Promise<BookingRecord> {
    const booking = await this.getBookingById(bookingId, userId);

    // Only mentor can confirm
    if (booking.mentor_id !== userId) {
      throw createError(ErrorCode.BOOKING_ONLY_MENTOR_CAN_CONFIRM, 403);
    }

    if (booking.status !== "pending") {
      throw createError(ErrorCode.BOOKING_NOT_PENDING, 400);
    }

    if (booking.payment_status !== "paid") {
      throw createError(ErrorCode.BOOKING_PAYMENT_REQUIRED_BEFORE_CONFIRMATION, 400);
    }

    // Soroban escrow creation is a network call — keep it OUTSIDE the DB
    // transaction to avoid blocking a connection while waiting on the chain.
    let onChainEscrow: {
      contractAddress: string;
      escrowId: string;
      txHash: string | null;
    } | null = null;

    if (SorobanEscrowService.isConfigured()) {
      onChainEscrow = await SorobanEscrowService.createEscrow({
        bookingId,
        learnerId: booking.mentee_id,
        mentorId: booking.mentor_id,
        amount: booking.amount,
        currency: booking.currency,
      });
    }

    // Atomic DB writes: booking status update + booking.confirmed outbox
    // event. If the process crashes after COMMIT, the outbox worker will
    // re-dispatch the notification fan-out reliably.
    const updated = await DatabaseService.withTransaction(async (client) => {
      const result = await BookingModel.updateWithClient(client, bookingId, {
        status: "confirmed",
      });
      if (!result) {
        throw createError(ErrorCode.BOOKING_CONFIRM_FAILED, 500);
      }

      if (onChainEscrow) {
        await client.query(
          `UPDATE bookings
           SET escrow_contract_address = $2,
               escrow_id = $3,
               stellar_tx_hash = COALESCE($4, stellar_tx_hash),
               updated_at = NOW()
           WHERE id = $1`,
          [
            bookingId,
            onChainEscrow.contractAddress,
            onChainEscrow.escrowId,
            onChainEscrow.txHash,
          ],
        );
      }

      await emitBookingConfirmed(
        {
          bookingId,
          mentorId: booking.mentor_id,
          menteeId: booking.mentee_id,
          scheduledAt: new Date(booking.scheduled_at).toISOString(),
          durationMinutes: booking.duration_minutes,
          topic: booking.topic,
          amount: booking.amount,
          currency: booking.currency,
          status: "confirmed",
        },
        { client, userId: userId },
      );

      return result;
    });

    // Invalidate session list cache for both users (best-effort)
    await CacheService.del(CacheKeys.sessionList(booking.mentee_id));
    await CacheService.del(CacheKeys.sessionList(booking.mentor_id));
    logger.debug("Booking cache invalidated on confirmation", { bookingId });

    await publishBookingDomainEvent(
      bookingId,
      BookingProjectionEventType.BookingStatusChanged,
      {
        previousStatus: booking.status,
        status: "confirmed",
        paymentStatus: booking.payment_status,
        escrowId: onChainEscrow?.escrowId,
        escrowContractAddress: onChainEscrow?.contractAddress,
      },
      userId,
    );

    CalendarService.createGoogleCalendarEvent(bookingId).catch((err) =>
      logger.error("Calendar create failed", { bookingId, error: err }),
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // Schedule no-show detection check
    // ═══════════════════════════════════════════════════════════════════════════
    const gracePeriodMinutes = parseInt(
      process.env.NO_SHOW_GRACE_PERIOD_MINUTES || '10',
      10
    );

    try {
      await scheduleNoShowCheck({
        bookingId,
        mentorId: booking.mentor_id,
        menteeId: booking.mentee_id,
        scheduledStart: booking.scheduled_at,
        gracePeriodMinutes,
      });

      logger.info('No-show check scheduled', {
        bookingId,
        scheduledStart: booking.scheduled_at,
        gracePeriodMinutes,
      });
    } catch (error) {
      logger.error('Failed to schedule no-show check', {
        bookingId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // Don't fail booking confirmation if scheduling fails
    }

    return updated;
  },

  async completeBooking(
    bookingId: string,
    userId: string,
  ): Promise<BookingRecord> {
    const booking = await this.getBookingById(bookingId, userId);

    // Either mentor or mentee can mark as completed
    if (booking.mentor_id !== userId && booking.mentee_id !== userId) {
      throw createError(ErrorCode.AUTHZ_FORBIDDEN, 403);
    }

    if (booking.status !== "confirmed") {
      throw createError(ErrorCode.BOOKING_NOT_CONFIRMED, 400);
    }

    // Verify session time has passed
    const sessionEnd = calculateEndTime(
      booking.scheduled_at,
      booking.duration_minutes,
    );
    if (sessionEnd > new Date()) {
      throw createError(ErrorCode.BOOKING_SESSION_NOT_ENDED, 400);
    }

    if (SorobanEscrowService.isConfigured()) {
      const metadata = await getBookingEscrowMetadata(bookingId);
      if (metadata.escrow_id) {
        if (userId === booking.mentee_id) {
          await SorobanEscrowService.releaseFunds({
            escrowId: metadata.escrow_id,
            releasedBy: userId,
            contractAddress: metadata.escrow_contract_address || undefined,
          });
        } else {
          // Mentor is completing the booking -> Schedule auto-release
          const { scheduleEscrowRelease } = await import("../queues/escrow-release.queue");
          await scheduleEscrowRelease({
            escrowId: metadata.escrow_id,
            mentorId: booking.mentor_id,
            learnerId: booking.mentee_id,
            sessionCompletedAt: new Date(),
          });
        }
      } else {
        logger.warn(
          "Skipping Soroban release/schedule: no escrow metadata on booking",
          {
            bookingId,
          },
        );
      }
    }

    const updated = await BookingModel.update(bookingId, {
      status: "completed",
    });

    if (!updated) {
      throw createError(ErrorCode.BOOKING_COMPLETION_FAILED, 500);
    }

    // Invalidate session list cache for both users
    await CacheService.del(CacheKeys.sessionList(booking.mentee_id));
    await CacheService.del(CacheKeys.sessionList(booking.mentor_id));

    // Invalidate learner progress cache for the mentee
    const { LearnerService } = await import("./learners.service");
    await LearnerService.invalidateCache(booking.mentee_id);

    logger.debug("Booking cache invalidated on completion", { bookingId });

    await publishBookingDomainEvent(
      bookingId,
      BookingProjectionEventType.BookingStatusChanged,
      {
        previousStatus: booking.status,
        status: "completed",
        paymentStatus: updated.payment_status,
        sessionId: booking.session_id,
      },
      userId,
    );

    // Emit session:updated event to both mentor and mentee
    SocketService.emitToUser(booking.mentor_id, "session:updated", {
      bookingId,
      status: "completed",
      updatedAt: updated.updated_at,
    });
    SocketService.emitToUser(booking.mentee_id, "session:updated", {
      bookingId,
      status: "completed",
      updatedAt: updated.updated_at,
    });

    // Fire-and-forget: Award loyalty points for the completed session
    LoyaltyService.accruePointsForCompletion(
      booking.mentee_id,
      bookingId,
      booking.duration_minutes,
    ).catch((err) => {
      logger.warn("Failed to accrue loyalty points", {
        bookingId,
        menteeId: booking.mentee_id,
        error: err,
      });
    });

    // Fire-and-forget: Generate AI session summary
    SessionSummaryModel.generateAndStore({
      bookingId,
      sessionId: booking.session_id || undefined,
      sessionNotes: booking.notes || undefined,
      sessionTitle: booking.topic,
    }).catch((err) => {
      logger.warn("Failed to generate session summary", {
        bookingId,
        error: err,
      });
    });

    return updated;
  },

  async cancelBooking(
    bookingId: string,
    userId: string,
    reason?: string,
  ): Promise<BookingRecord> {
    const booking = await this.getBookingById(bookingId, userId);

    if (["cancelled", "completed"].includes(booking.status)) {
      throw createError(ErrorCode.BOOKING_ALREADY_CANCELLED, 400);
    }

    // Calculate refund eligibility
    const refundInfo = calculateRefundEligibility(booking.scheduled_at);

    let sorobanRefunded = false;

    if (
      isCancelledBeforeSession(booking) &&
      SorobanEscrowService.isConfigured()
    ) {
      const metadata = await getBookingEscrowMetadata(bookingId);
      if (metadata.escrow_id) {
        const refundResult = await SorobanEscrowService.refund({
          escrowId: metadata.escrow_id,
          refundedBy: userId,
          contractAddress: metadata.escrow_contract_address || undefined,
          amount: refundInfo.eligible
            ? String(
                parseFloat(booking.amount) *
                  (refundInfo.refundPercentage / 100),
              )
            : undefined,
        });
        await BookingModel.update(bookingId, {
          paymentStatus: "refunded",
          ...(refundResult.txHash
            ? { stellarTxHash: refundResult.txHash }
            : {}),
        });
        sorobanRefunded = true;
        logger.info("Soroban refund successful", {
          bookingId,
          txHash: refundResult.txHash,
        });
        
        // Cancel any pending auto-release
        const { cancelEscrowRelease } = await import("../queues/escrow-release.queue");
        await cancelEscrowRelease(metadata.escrow_id);
      } else {
        logger.warn("Skipping Soroban refund: no escrow metadata on booking", {
          bookingId,
        });
      }
    }

    const updated = await BookingModel.update(bookingId, {
      status: "cancelled",
      cancellationReason: reason || "No reason provided",
      ...(!sorobanRefunded && {
        paymentStatus: refundInfo.eligible
          ? "refund_pending"
          : booking.payment_status,
      }),
    });

    if (!updated) {
      throw createError(ErrorCode.BOOKING_CANCELLATION_FAILED, 500);
    }

    // Invalidate session list cache for both users
    await CacheService.del(CacheKeys.sessionList(booking.mentee_id));
    await CacheService.del(CacheKeys.sessionList(booking.mentor_id));
    logger.debug("Booking cache invalidated on cancellation", { bookingId });

    await publishBookingDomainEvent(
      bookingId,
      BookingProjectionEventType.BookingCancelled,
      {
        previousStatus: booking.status,
        cancellationReason: reason || "No reason provided",
        refundEligible: refundInfo.eligible,
        refundPercentage: refundInfo.refundPercentage,
        paymentStatus: updated.payment_status,
        transactionId: booking.transaction_id,
        amount: booking.amount,
        currency: booking.currency,
        menteeId: booking.mentee_id,
      },
      userId,
    );

    if (!sorobanRefunded && refundInfo.eligible && booking.transaction_id) {
      await QueueService.submitStellarTx(
        {
          type: "refund",
          paymentId: booking.transaction_id,
          amount: String(
            parseFloat(booking.amount) * (refundInfo.refundPercentage / 100),
          ),
          currency: booking.currency,
          userId: booking.mentee_id,
          description: refundInfo.reason,
        },
        `refund:booking:${bookingId}`,
      );
      logger.info("Refund job enqueued", { bookingId, refundInfo });
    }

    // Emit session:updated event to both mentor and mentee
    SocketService.emitToUser(booking.mentor_id, "session:updated", {
      bookingId,
      status: "cancelled",
      cancellationReason: reason || "No reason provided",
      updatedAt: updated.updated_at,
    });
    SocketService.emitToUser(booking.mentee_id, "session:updated", {
      bookingId,
      status: "cancelled",
      cancellationReason: reason || "No reason provided",
      updatedAt: updated.updated_at,
    });

    // Send multi-channel cancellation notifications to both mentor and mentee
    try {
      const notificationPayload = {
        type: NotificationType.SESSION_CANCELLED,
        channels: [
          NotificationChannel.EMAIL,
          NotificationChannel.IN_APP,
          NotificationChannel.PUSH,
        ],
        priority: NotificationPriority.HIGH,
        data: {
          bookingId,
          scheduledAt: booking.scheduled_at,
          durationMinutes: booking.duration_minutes,
          topic: booking.topic,
          cancellationReason: reason || "No reason provided",
          amount: booking.amount,
          currency: booking.currency,
          mentorId: booking.mentor_id,
          menteeId: booking.mentee_id,
        },
      };

      await Promise.all([
        NotificationService.sendNotification({
          userId: booking.mentor_id,
          ...notificationPayload,
        }),
        NotificationService.sendNotification({
          userId: booking.mentee_id,
          ...notificationPayload,
        }),
      ]);

      logger.info("Booking cancellation notifications sent", {
        bookingId,
        mentorId: booking.mentor_id,
        menteeId: booking.mentee_id,
      });
    } catch (notificationError) {
      logger.error("Failed to send booking cancellation notifications", {
        bookingId,
        error:
          notificationError instanceof Error
            ? notificationError.message
            : notificationError,
      });
    }

    CalendarService.deleteGoogleCalendarEvent(bookingId).catch((err) =>
      logger.error("Calendar delete failed", { bookingId, error: err }),
    );

    return updated;
  },

  async rescheduleBooking(
    bookingId: string,
    userId: string,
    newScheduledAt: Date,
    reason?: string,
  ): Promise<BookingRecord> {
    const booking = await this.getBookingById(bookingId, userId);

    if (!["pending", "confirmed"].includes(booking.status)) {
      throw createError(ErrorCode.BOOKING_RESCHEDULE_NOT_ALLOWED, 400);
    }

    // Check for conflicts at new time
    const hasConflict = await BookingModel.checkConflict(
      booking.mentor_id,
      newScheduledAt,
      booking.duration_minutes,
      bookingId,
    );

    if (hasConflict) {
      throw createError(ErrorCode.BOOKING_CONFLICT, 409);
    }

    const updated = await BookingModel.update(bookingId, {
      scheduledAt: newScheduledAt,
      status: "rescheduled",
      notes: booking.notes
        ? `${booking.notes}\n\nRescheduled: ${reason || "No reason provided"}`
        : `Rescheduled: ${reason || "No reason provided"}`,
    });

    if (!updated) {
      throw createError(ErrorCode.BOOKING_RESCHEDULE_FAILED, 500);
    }

    // Emit session:updated event to both mentor and mentee
    SocketService.emitToUser(booking.mentor_id, "session:updated", {
      bookingId,
      status: "rescheduled",
      newScheduledAt,
      reason: reason || "No reason provided",
      updatedAt: updated.updated_at,
    });
    SocketService.emitToUser(booking.mentee_id, "session:updated", {
      bookingId,
      status: "rescheduled",
      newScheduledAt,
      reason: reason || "No reason provided",
      updatedAt: updated.updated_at,
    });

    CalendarService.updateGoogleCalendarEvent(bookingId).catch((err) =>
      logger.error("Calendar update failed", { bookingId, error: err }),
    );

    return updated;
  },

  async getPaymentStatus(
    bookingId: string,
    userId: string,
  ): Promise<{
    paymentStatus: string;
    amount: string;
    currency: string;
    stellarTxHash: string | null;
    transactionId: string | null;
  }> {
    const booking = await this.getBookingById(bookingId, userId);

    return {
      paymentStatus: booking.payment_status,
      amount: booking.amount,
      currency: booking.currency,
      stellarTxHash: booking.stellar_tx_hash,
      transactionId: booking.transaction_id,
    };
  },

  async updatePaymentStatus(
    bookingId: string,
    stellarTxHash: string,
    transactionId: string,
  ): Promise<BookingRecord> {
    const updated = await BookingModel.update(bookingId, {
      paymentStatus: "paid",
      stellarTxHash,
      transactionId,
    });

    if (!updated) {
      throw createError(ErrorCode.PAYMENT_CONFIRM_FAILED, 500);
    }

    return updated;
  },

  /**
   * Dispute a recorded no-show within the configured dispute window (default 24h).
   * Only the offender for this booking may dispute, and only while the dispute
   * deadline has not elapsed.
   */
  async disputeNoShow(
    bookingId: string,
    userId: string,
    reason: string,
  ): Promise<BookingRecord> {
    const { rows } = await db.query(
      `SELECT id, status, no_show_offender_role, no_show_dispute_status,
              no_show_dispute_deadline, mentor_id, mentee_id, no_show_penalty_points
       FROM bookings WHERE id = $1`,
      [bookingId],
    );

    const booking = rows[0] as {
      id: string;
      status: string;
      no_show_offender_role: "mentor" | "mentee" | null;
      no_show_dispute_status: "none" | "pending" | "approved" | "dismissed";
      no_show_dispute_deadline: Date | null;
      mentor_id: string;
      mentee_id: string;
      no_show_penalty_points: number;
    };

    if (!booking) {
      throw createError(ErrorCode.BOOKING_NOT_FOUND, 404);
    }

    if (booking.status !== "no_show") {
      throw createError(ErrorCode.BOOKING_INVALID_STATUS, 400);
    }

    if (!booking.no_show_offender_role || !booking.no_show_dispute_deadline) {
      throw createError(ErrorCode.BOOKING_INVALID_STATUS, 400);
    }

    // Only the offender can dispute the no-show marking.
    const offenderUserId =
      booking.no_show_offender_role === "mentor"
        ? booking.mentor_id
        : booking.mentee_id;
    if (userId !== offenderUserId) {
      throw createError(ErrorCode.AUTHZ_FORBIDDEN, 403);
    }

    // Dispute window must still be open.
    if (new Date(booking.no_show_dispute_deadline).getTime() < Date.now()) {
      throw createError(ErrorCode.BOOKING_INVALID_STATUS, 400);
    }

    // Must not already be in a pending/resolved dispute.
    if (booking.no_show_dispute_status !== "none") {
      throw createError(ErrorCode.BOOKING_INVALID_STATUS, 400);
    }

    const updated = await BookingModel.update(bookingId, {
      noShowDisputeStatus: "pending",
      noShowDisputedAt: new Date(),
      noShowDisputeReason: reason,
    });

    if (!updated) {
      throw createError(ErrorCode.BOOKING_UPDATE_FAILED, 500);
    }

    // Reflect the pending dispute on the in-app notification + audit trail.
    try {
      await NotificationService.sendNotification({
        userId: offenderUserId,
        type: NotificationType.NO_SHOW_DISPUTE,
        title: "No-Show Dispute Submitted",
        message: `Your dispute for booking ${bookingId} has been received and is pending review.`,
        channels: [NotificationChannel.EMAIL, NotificationChannel.IN_APP],
        priority: NotificationPriority.NORMAL,
        data: { bookingId, reason },
      });
    } catch (notificationError) {
      logger.warn("Dispute confirmation notification failed", {
        bookingId,
        error:
          notificationError instanceof Error
            ? notificationError.message
            : notificationError,
      });
    }

    await publishBookingDomainEvent(
      bookingId,
      BookingProjectionEventType.BookingStatusChanged,
      {
        previousStatus: "no_show",
        status: "no_show",
        disputeStatus: "pending",
      },
      userId,
    );

    return updated;
  },

  /**
   * Resolve a pending no-show dispute. On approval the penalty strike is wiped
   * and the offender's penalty points are refunded; on dismissal the penalty
   * stands.
   */
  async resolveNoShowDispute(
    bookingId: string,
    adminUserId: string,
    decision: "approved" | "dismissed",
    resolutionNote?: string,
  ): Promise<BookingRecord> {
    const { rows } = await db.query(
      `SELECT id, status, no_show_offender_role, no_show_dispute_status,
              no_show_penalty_points, mentor_id, mentee_id
       FROM bookings WHERE id = $1`,
      [bookingId],
    );

    const booking = rows[0] as {
      id: string;
      status: string;
      no_show_offender_role: "mentor" | "mentee" | null;
      no_show_dispute_status: "none" | "pending" | "approved" | "dismissed";
      no_show_penalty_points: number;
      mentor_id: string;
      mentee_id: string;
    };

    if (!booking) {
      throw createError(ErrorCode.BOOKING_NOT_FOUND, 404);
    }

    if (booking.status !== "no_show" || booking.no_show_dispute_status !== "pending") {
      throw createError(ErrorCode.BOOKING_INVALID_STATUS, 400);
    }

    const offenderId =
      booking.no_show_offender_role === "mentor"
        ? booking.mentor_id
        : booking.mentee_id;

    const updated = await BookingModel.update(bookingId, {
      noShowDisputeStatus: decision,
      noShowDisputeReason: resolutionNote,
    });

    if (!updated) {
      throw createError(ErrorCode.BOOKING_UPDATE_FAILED, 500);
    }

    // Update the penalty ledger + user aggregates based on the decision.
    try {
      if (decision === "approved") {
        // Wipe the strike and refund the penalty points.
        await db.query(
          `UPDATE no_show_penalties
           SET status = 'waived', resolution = $1, resolved_by = $2, resolved_at = NOW()
           WHERE booking_id = $3`,
          [resolutionNote || "approved", adminUserId, bookingId],
        );
        await db.query(
          `UPDATE users
           SET active_penalty_points = GREATEST(0, active_penalty_points - $1)
           WHERE id = $2`,
          [booking.no_show_penalty_points, offenderId],
        );
      } else {
        await db.query(
          `UPDATE no_show_penalties
           SET status = 'served', resolution = $1, resolved_by = $2, resolved_at = NOW()
           WHERE booking_id = $3`,
          [resolutionNote || "dismissed", adminUserId, bookingId],
        );
      }
    } catch (penaltyError) {
      logger.warn("Failed to update no-show penalty on dispute resolution", {
        bookingId,
        error:
          penaltyError instanceof Error ? penaltyError.message : penaltyError,
      });
    }

    return updated;
  },
};
