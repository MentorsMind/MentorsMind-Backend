import { Response } from 'express';
import { AuthenticatedRequest } from '../types/api.types';
import { BookingsService } from '../services/bookings.service';
import { ResponseUtil } from '../utils/response.utils';

export const BookingsController = {
  /** POST /bookings - Create new booking */
  async createBooking(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { mentorId, scheduledAt, durationMinutes, topic, notes } = req.body;
    
    const booking = await BookingsService.createBooking({
      menteeId: req.user!.id,
      mentorId,
      scheduledAt: new Date(scheduledAt),
      durationMinutes,
      topic,
      notes,
    });

    ResponseUtil.created(res, booking, 'Booking created successfully');
  },

  /** GET /bookings/:id - Get booking details */
  async getBooking(req: AuthenticatedRequest, res: Response): Promise<void> {
    const booking = await BookingsService.getBookingById(req.params.id, req.user!.id);
    ResponseUtil.success(res, booking, 'Booking retrieved successfully');
  },

  /** PUT /bookings/:id - Update booking */
  async updateBooking(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { scheduledAt, durationMinutes, topic, notes } = req.body;
    
    const booking = await BookingsService.updateBooking(
      req.params.id,
      req.user!.id,
      {
        scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
        durationMinutes,
        topic,
        notes,
      }
    );

    ResponseUtil.success(res, booking, 'Booking updated successfully');
  },

  /** DELETE /bookings/:id - Cancel booking */
  async cancelBooking(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { reason } = req.body;
    
    const booking = await BookingsService.cancelBooking(
      req.params.id,
      req.user!.id,
      reason
    );

    ResponseUtil.success(res, booking, 'Booking cancelled successfully');
  },

  /** GET /bookings - List user bookings */
  async listBookings(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { page, limit, status } = req.query;
    
    const result = await BookingsService.getUserBookings(req.user!.id, {
      status: status as string,
      page: page ? parseInt(page as string, 10) : undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
    });

    const pageNum = page ? parseInt(page as string, 10) : 1;
    const limitNum = limit ? parseInt(limit as string, 10) : 10;
    const totalPages = Math.ceil(result.total / limitNum);

    ResponseUtil.success(
      res,
      result.bookings,
      'Bookings retrieved successfully',
      200,
      {
        page: pageNum,
        limit: limitNum,
        total: result.total,
        totalPages,
        hasNext: pageNum < totalPages,
        hasPrev: pageNum > 1,
      }
    );
  },

  /** POST /bookings/:id/confirm - Confirm booking */
  async confirmBooking(req: AuthenticatedRequest, res: Response): Promise<void> {
    const booking = await BookingsService.confirmBooking(req.params.id, req.user!.id);
    ResponseUtil.success(res, booking, 'Booking confirmed successfully');
  },

  /** POST /bookings/:id/complete - Mark as completed */
  async completeBooking(req: AuthenticatedRequest, res: Response): Promise<void> {
    const booking = await BookingsService.completeBooking(req.params.id, req.user!.id);
    ResponseUtil.success(res, booking, 'Booking marked as completed');
  },

  /** POST /bookings/:id/reschedule - Reschedule booking */
  async rescheduleBooking(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { scheduledAt, reason } = req.body;
    
    const booking = await BookingsService.rescheduleBooking(
      req.params.id,
      req.user!.id,
      new Date(scheduledAt),
      reason
    );

    ResponseUtil.success(res, booking, 'Booking rescheduled successfully');
  },

  /** GET /bookings/:id/payment-status - Check payment */
  async getPaymentStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    const paymentInfo = await BookingsService.getPaymentStatus(req.params.id, req.user!.id);
    ResponseUtil.success(res, paymentInfo, 'Payment status retrieved successfully');
  },
};
