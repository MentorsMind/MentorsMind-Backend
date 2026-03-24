import { BookingsService } from '../bookings.service';
import { BookingModel } from '../../models/booking.model';
import { UsersService } from '../users.service';
import { createError } from '../../middleware/errorHandler';

jest.mock('../../models/booking.model');
jest.mock('../users.service');

describe('BookingsService', () => {
  const mockMentee = {
    id: 'mentee-123',
    email: '[email]',
    role: 'mentee',
    first_name: 'John',
    last_name: 'Doe',
  };

  const mockMentor = {
    id: 'mentor-456',
    email: '[email]',
    role: 'mentor',
    first_name: 'Jane',
    last_name: 'Smith',
  };

  const mockBooking = {
    id: 'booking-789',
    mentee_id: 'mentee-123',
    mentor_id: 'mentor-456',
    scheduled_at: new Date('2026-03-25T14:00:00Z'),
    duration_minutes: 60,
    topic: 'Career guidance',
    notes: 'Looking for advice',
    status: 'pending',
    amount: '50.0000000',
    currency: 'XLM',
    payment_status: 'pending',
    stellar_tx_hash: null,
    transaction_id: null,
    cancellation_reason: null,
    created_at: new Date(),
    updated_at: new Date(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createBooking', () => {
    it('should create a booking successfully', async () => {
      (UsersService.findById as jest.Mock)
        .mockResolvedValueOnce(mockMentee)
        .mockResolvedValueOnce(mockMentor);
      (BookingModel.checkConflict as jest.Mock).mockResolvedValue(false);
      (BookingModel.create as jest.Mock).mockResolvedValue(mockBooking);

      const result = await BookingsService.createBooking({
        menteeId: 'mentee-123',
        mentorId: 'mentor-456',
        scheduledAt: new Date('2026-03-25T14:00:00Z'),
        durationMinutes: 60,
        topic: 'Career guidance',
        notes: 'Looking for advice',
      });

      expect(result).toEqual(mockBooking);
      expect(BookingModel.checkConflict).toHaveBeenCalledWith(
        'mentor-456',
        expect.any(Date),
        60
      );
    });

    it('should throw error if mentee not found', async () => {
      (UsersService.findById as jest.Mock).mockResolvedValue(null);

      await expect(
        BookingsService.createBooking({
          menteeId: 'invalid',
          mentorId: 'mentor-456',
          scheduledAt: new Date('2026-03-25T14:00:00Z'),
          durationMinutes: 60,
          topic: 'Career guidance',
        })
      ).rejects.toThrow('Mentee not found');
    });

    it('should throw error if mentor not found', async () => {
      (UsersService.findById as jest.Mock)
        .mockResolvedValueOnce(mockMentee)
        .mockResolvedValueOnce(null);

      await expect(
        BookingsService.createBooking({
          menteeId: 'mentee-123',
          mentorId: 'invalid',
          scheduledAt: new Date('2026-03-25T14:00:00Z'),
          durationMinutes: 60,
          topic: 'Career guidance',
        })
      ).rejects.toThrow('Mentor not found');
    });

    it('should throw error if user is not a mentor', async () => {
      const nonMentor = { ...mockMentor, role: 'mentee' };
      (UsersService.findById as jest.Mock)
        .mockResolvedValueOnce(mockMentee)
        .mockResolvedValueOnce(nonMentor);

      await expect(
        BookingsService.createBooking({
          menteeId: 'mentee-123',
          mentorId: 'mentor-456',
          scheduledAt: new Date('2026-03-25T14:00:00Z'),
          durationMinutes: 60,
          topic: 'Career guidance',
        })
      ).rejects.toThrow('User is not a mentor');
    });

    it('should throw error on booking conflict', async () => {
      (UsersService.findById as jest.Mock)
        .mockResolvedValueOnce(mockMentee)
        .mockResolvedValueOnce(mockMentor);
      (BookingModel.checkConflict as jest.Mock).mockResolvedValue(true);

      await expect(
        BookingsService.createBooking({
          menteeId: 'mentee-123',
          mentorId: 'mentor-456',
          scheduledAt: new Date('2026-03-25T14:00:00Z'),
          durationMinutes: 60,
          topic: 'Career guidance',
        })
      ).rejects.toThrow('Mentor is not available at the requested time');
    });
  });

  describe('cancelBooking', () => {
    it('should cancel booking with full refund (24+ hours)', async () => {
      const futureBooking = {
        ...mockBooking,
        scheduled_at: new Date(Date.now() + 25 * 60 * 60 * 1000), // 25 hours from now
      };
      (BookingModel.findById as jest.Mock).mockResolvedValue(futureBooking);
      (BookingModel.update as jest.Mock).mockResolvedValue({
        ...futureBooking,
        status: 'cancelled',
        payment_status: 'refunded',
      });

      const result = await BookingsService.cancelBooking(
        'booking-789',
        'mentee-123',
        'Schedule conflict'
      );

      expect(result.status).toBe('cancelled');
      expect(result.payment_status).toBe('refunded');
    });

    it('should cancel booking with no refund (<12 hours)', async () => {
      const soonBooking = {
        ...mockBooking,
        scheduled_at: new Date(Date.now() + 6 * 60 * 60 * 1000), // 6 hours from now
      };
      (BookingModel.findById as jest.Mock).mockResolvedValue(soonBooking);
      (BookingModel.update as jest.Mock).mockResolvedValue({
        ...soonBooking,
        status: 'cancelled',
      });

      const result = await BookingsService.cancelBooking(
        'booking-789',
        'mentee-123',
        'Emergency'
      );

      expect(result.status).toBe('cancelled');
      expect(result.payment_status).toBe('pending');
    });

    it('should throw error if booking already cancelled', async () => {
      const cancelledBooking = { ...mockBooking, status: 'cancelled' };
      (BookingModel.findById as jest.Mock).mockResolvedValue(cancelledBooking);

      await expect(
        BookingsService.cancelBooking('booking-789', 'mentee-123')
      ).rejects.toThrow('Cannot cancel booking in current status');
    });
  });

  describe('confirmBooking', () => {
    it('should confirm booking successfully', async () => {
      const paidBooking = { ...mockBooking, payment_status: 'paid' };
      (BookingModel.findById as jest.Mock).mockResolvedValue(paidBooking);
      (BookingModel.update as jest.Mock).mockResolvedValue({
        ...paidBooking,
        status: 'confirmed',
      });

      const result = await BookingsService.confirmBooking(
        'booking-789',
        'mentor-456'
      );

      expect(result.status).toBe('confirmed');
    });

    it('should throw error if not mentor', async () => {
      (BookingModel.findById as jest.Mock).mockResolvedValue(mockBooking);

      await expect(
        BookingsService.confirmBooking('booking-789', 'mentee-123')
      ).rejects.toThrow('Only the mentor can confirm bookings');
    });

    it('should throw error if payment not completed', async () => {
      (BookingModel.findById as jest.Mock).mockResolvedValue(mockBooking);

      await expect(
        BookingsService.confirmBooking('booking-789', 'mentor-456')
      ).rejects.toThrow('Payment must be completed before confirmation');
    });
  });

  describe('completeBooking', () => {
    it('should complete booking after session ends', async () => {
      const pastBooking = {
        ...mockBooking,
        status: 'confirmed',
        scheduled_at: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
      };
      (BookingModel.findById as jest.Mock).mockResolvedValue(pastBooking);
      (BookingModel.update as jest.Mock).mockResolvedValue({
        ...pastBooking,
        status: 'completed',
      });

      const result = await BookingsService.completeBooking(
        'booking-789',
        'mentor-456'
      );

      expect(result.status).toBe('completed');
    });

    it('should throw error if session not ended', async () => {
      const futureBooking = {
        ...mockBooking,
        status: 'confirmed',
        scheduled_at: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours from now
      };
      (BookingModel.findById as jest.Mock).mockResolvedValue(futureBooking);

      await expect(
        BookingsService.completeBooking('booking-789', 'mentor-456')
      ).rejects.toThrow('Cannot complete booking before session ends');
    });
  });

  describe('rescheduleBooking', () => {
    it('should reschedule booking successfully', async () => {
      (BookingModel.findById as jest.Mock).mockResolvedValue(mockBooking);
      (BookingModel.checkConflict as jest.Mock).mockResolvedValue(false);
      (BookingModel.update as jest.Mock).mockResolvedValue({
        ...mockBooking,
        status: 'rescheduled',
        scheduled_at: new Date('2026-03-26T14:00:00Z'),
      });

      const result = await BookingsService.rescheduleBooking(
        'booking-789',
        'mentee-123',
        new Date('2026-03-26T14:00:00Z'),
        'Mentor requested'
      );

      expect(result.status).toBe('rescheduled');
    });

    it('should throw error on conflict', async () => {
      (BookingModel.findById as jest.Mock).mockResolvedValue(mockBooking);
      (BookingModel.checkConflict as jest.Mock).mockResolvedValue(true);

      await expect(
        BookingsService.rescheduleBooking(
          'booking-789',
          'mentee-123',
          new Date('2026-03-26T14:00:00Z')
        )
      ).rejects.toThrow('Mentor is not available at the requested time');
    });
  });
});
