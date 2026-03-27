import { BookingModel, BookingRecord } from '../models/booking.model';
import { CacheService } from './cache.service';
import { CacheKeys, CacheTTL } from '../utils/cache-key.utils';
import { logger } from '../utils/logger.utils';
import { createError } from '../middleware/errorHandler';
import { calculateEndTime, calculateRefundEligibility } from '../utils/booking-conflicts.utils';
import { SocketService } from './socket.service';
import pool from '../config/database';

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

export const BookingsService = {
  async initialize(): Promise<void> {
    await BookingModel.initializeTable();
  },

  async createBooking(data: CreateBookingData): Promise<BookingRecord> {
    // Batch-validate both users in a single query (avoids N+1)
    const { rows: users } = await pool.query(
      `SELECT id, role FROM users WHERE id = ANY($1) AND is_active = true`,
      [[data.menteeId, data.mentorId]]
    );

    const mentee = users.find((u: any) => u.id === data.menteeId);
    const mentor = users.find((u: any) => u.id === data.mentorId);

    if (!mentee) {
      throw createError('Mentee not found', 404);
    }
    if (!mentor) {
      throw createError('Mentor not found', 404);
    }
    if (mentor.role !== 'mentor') {
      throw createError('User is not a mentor', 400);
    }

    // Check for booking conflicts
    const hasConflict = await BookingModel.checkConflict(
      data.mentorId,
      data.scheduledAt,
      data.durationMinutes
    );

    if (hasConflict) {
      throw createError('Mentor is not available at the requested time', 409);
    }

    // Calculate amount (placeholder - should fetch from mentor profile)
    const hourlyRate = 50; // TODO: Fetch from mentor profile
    const amount = ((data.durationMinutes / 60) * hourlyRate).toFixed(7);

    // Create booking
    const booking = await BookingModel.create({
      menteeId: data.menteeId,
      mentorId: data.mentorId,
      scheduledAt: data.scheduledAt,
      durationMinutes: data.durationMinutes,
      topic: data.topic,
      notes: data.notes,
      amount,
      currency: 'XLM',
    });

    return booking;
  },

  async getBookingById(bookingId: string, userId: string): Promise<BookingRecord> {
    const booking = await BookingModel.findById(bookingId);
    
    if (!booking) {
      throw createError('Booking not found', 404);
    }

    // Verify user has access to this booking
    if (booking.mentee_id !== userId && booking.mentor_id !== userId) {
      throw createError('Access denied', 403);
    }

    return booking;
  },

  async getUserBookings(
    userId: string,
    filters?: { status?: string; page?: number; limit?: number }
  ): Promise<{ bookings: BookingRecord[]; total: number }> {
    const cacheKey = CacheKeys.sessionList(userId);
    
    // Try to get from cache first
    const cached = await CacheService.get<{ bookings: BookingRecord[]; total: number }>(cacheKey);
    if (cached !== null) {
      logger.debug('bookings.getUserBookings cache hit', { userId });
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
    data: UpdateBookingData
  ): Promise<BookingRecord> {
    const booking = await this.getBookingById(bookingId, userId);

    // Only allow updates if booking is pending or confirmed
    if (!['pending', 'confirmed'].includes(booking.status)) {
      throw createError('Cannot update booking in current status', 400);
    }

    // Only mentee can update booking details
    if (booking.mentee_id !== userId) {
      throw createError('Only the mentee can update booking details', 403);
    }

    // If rescheduling, check for conflicts
    if (data.scheduledAt || data.durationMinutes) {
      const newScheduledAt = data.scheduledAt || booking.scheduled_at;
      const newDuration = data.durationMinutes || booking.duration_minutes;

      const hasConflict = await BookingModel.checkConflict(
        booking.mentor_id,
        newScheduledAt,
        newDuration,
        bookingId
      );

      if (hasConflict) {
        throw createError('Mentor is not available at the requested time', 409);
      }
    }

    const updated = await BookingModel.update(bookingId, {
      scheduledAt: data.scheduledAt,
      durationMinutes: data.durationMinutes,
      topic: data.topic,
      notes: data.notes,
    });

    if (!updated) {
      throw createError('Failed to update booking', 500);
    }

    // Invalidate session list cache for both mentee and mentor
    await CacheService.del(CacheKeys.sessionList(booking.mentee_id));
    await CacheService.del(CacheKeys.sessionList(booking.mentor_id));
    logger.debug('Booking cache invalidated on update', { bookingId });

    return updated;
  },

  async confirmBooking(bookingId: string, userId: string): Promise<BookingRecord> {
    const booking = await this.getBookingById(bookingId, userId);

    // Only mentor can confirm
    if (booking.mentor_id !== userId) {
      throw createError('Only the mentor can confirm bookings', 403);
    }

    if (booking.status !== 'pending') {
      throw createError('Booking is not in pending status', 400);
    }

    if (booking.payment_status !== 'paid') {
      throw createError('Payment must be completed before confirmation', 400);
    }

    const updated = await BookingModel.update(bookingId, { status: 'confirmed' });
    
    if (!updated) {
      throw createError('Failed to confirm booking', 500);
    }

    // Invalidate session list cache for both users
    await CacheService.del(CacheKeys.sessionList(booking.mentee_id));
    await CacheService.del(CacheKeys.sessionList(booking.mentor_id));
    logger.debug('Booking cache invalidated on confirmation', { bookingId });
    // Emit session:updated event to both mentor and mentee
    SocketService.emitToUser(booking.mentor_id, 'session:updated', {
      bookingId,
      status: 'confirmed',
      updatedAt: updated.updated_at,
    });
    SocketService.emitToUser(booking.mentee_id, 'session:updated', {
      bookingId,
      status: 'confirmed',
      updatedAt: updated.updated_at,
    });

    return updated;
  },

  async completeBooking(bookingId: string, userId: string): Promise<BookingRecord> {
    const booking = await this.getBookingById(bookingId, userId);

    // Either mentor or mentee can mark as completed
    if (booking.mentor_id !== userId && booking.mentee_id !== userId) {
      throw createError('Access denied', 403);
    }

    if (booking.status !== 'confirmed') {
      throw createError('Only confirmed bookings can be completed', 400);
    }

    // Verify session time has passed
    const sessionEnd = calculateEndTime(booking.scheduled_at, booking.duration_minutes);
    if (sessionEnd > new Date()) {
      throw createError('Cannot complete booking before session ends', 400);
    }

    const updated = await BookingModel.update(bookingId, { status: 'completed' });
    
    if (!updated) {
      throw createError('Failed to complete booking', 500);
    }

    // Invalidate session list cache for both users
    await CacheService.del(CacheKeys.sessionList(booking.mentee_id));
    await CacheService.del(CacheKeys.sessionList(booking.mentor_id));
    logger.debug('Booking cache invalidated on completion', { bookingId });
    // Emit session:updated event to both mentor and mentee
    SocketService.emitToUser(booking.mentor_id, 'session:updated', {
      bookingId,
      status: 'completed',
      updatedAt: updated.updated_at,
    });
    SocketService.emitToUser(booking.mentee_id, 'session:updated', {
      bookingId,
      status: 'completed',
      updatedAt: updated.updated_at,
    });

    return updated;
  },

  async cancelBooking(
    bookingId: string,
    userId: string,
    reason?: string
  ): Promise<BookingRecord> {
    const booking = await this.getBookingById(bookingId, userId);

    if (['cancelled', 'completed'].includes(booking.status)) {
      throw createError('Cannot cancel booking in current status', 400);
    }

    // Calculate refund eligibility
    const refundInfo = calculateRefundEligibility(booking.scheduled_at);

    const updated = await BookingModel.update(bookingId, {
      status: 'cancelled',
      cancellationReason: reason || 'No reason provided',
      paymentStatus: refundInfo.eligible ? 'refunded' : booking.payment_status,
    });

    if (!updated) {
      throw createError('Failed to cancel booking', 500);
    }

    // Invalidate session list cache for both users
    await CacheService.del(CacheKeys.sessionList(booking.mentee_id));
    await CacheService.del(CacheKeys.sessionList(booking.mentor_id));
    logger.debug('Booking cache invalidated on cancellation', { bookingId });

    // TODO: Process refund via Stellar if eligible

    // Emit session:updated event to both mentor and mentee
    SocketService.emitToUser(booking.mentor_id, 'session:updated', {
      bookingId,
      status: 'cancelled',
      cancellationReason: reason || 'No reason provided',
      updatedAt: updated.updated_at,
    });
    SocketService.emitToUser(booking.mentee_id, 'session:updated', {
      bookingId,
      status: 'cancelled',
      cancellationReason: reason || 'No reason provided',
      updatedAt: updated.updated_at,
    });

    return updated;
  },

  async rescheduleBooking(
    bookingId: string,
    userId: string,
    newScheduledAt: Date,
    reason?: string
  ): Promise<BookingRecord> {
    const booking = await this.getBookingById(bookingId, userId);

    if (!['pending', 'confirmed'].includes(booking.status)) {
      throw createError('Cannot reschedule booking in current status', 400);
    }

    // Check for conflicts at new time
    const hasConflict = await BookingModel.checkConflict(
      booking.mentor_id,
      newScheduledAt,
      booking.duration_minutes,
      bookingId
    );

    if (hasConflict) {
      throw createError('Mentor is not available at the requested time', 409);
    }

    const updated = await BookingModel.update(bookingId, {
      scheduledAt: newScheduledAt,
      status: 'rescheduled',
      notes: booking.notes
        ? `${booking.notes}\n\nRescheduled: ${reason || 'No reason provided'}`
        : `Rescheduled: ${reason || 'No reason provided'}`,
    });

    if (!updated) {
      throw createError('Failed to reschedule booking', 500);
    }

    // Emit session:updated event to both mentor and mentee
    SocketService.emitToUser(booking.mentor_id, 'session:updated', {
      bookingId,
      status: 'rescheduled',
      newScheduledAt,
      reason: reason || 'No reason provided',
      updatedAt: updated.updated_at,
    });
    SocketService.emitToUser(booking.mentee_id, 'session:updated', {
      bookingId,
      status: 'rescheduled',
      newScheduledAt,
      reason: reason || 'No reason provided',
      updatedAt: updated.updated_at,
    });

    return updated;
  },

  async getPaymentStatus(bookingId: string, userId: string): Promise<{
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
    transactionId: string
  ): Promise<BookingRecord> {
    const updated = await BookingModel.update(bookingId, {
      paymentStatus: 'paid',
      stellarTxHash,
      transactionId,
    });

    if (!updated) {
      throw createError('Failed to update payment status', 500);
    }

    return updated;
  },
};
