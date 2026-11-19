import { BookingsService } from '../bookings.service';
import { BookingModel } from '../../models/booking.model';
import { db } from '../../config/database';
import { CacheService } from '../cache.service';
import { SocketService } from '../socket.service';
import { SorobanEscrowService } from '../sorobanEscrow.service';
import { MentorsService } from '../mentors.service';
import { AssetExchangeService } from '../assetExchange.service';
import { NotificationService } from '../notification.service';
import { CalendarService } from '../calendar.service';
import { QueueService } from '../queue.service';
import { LoyaltyService } from '../loyalty.service';
import { SessionSummaryModel } from '../../models/session-summary.model';

const mockClient = {
  query: jest.fn(),
  release: jest.fn(),
};

jest.mock('../../models/booking.model');
jest.mock('../../config/database', () => ({
  db: {
    query: jest.fn(),
    connect: jest.fn(),
  }
}));
jest.mock('../cache.service');
jest.mock('../socket.service');
jest.mock('../sorobanEscrow.service');
jest.mock('../mentors.service');
jest.mock('../assetExchange.service');
jest.mock('../notification.service');
jest.mock('../calendar.service');
jest.mock('../queue.service');
jest.mock('../loyalty.service');
jest.mock('../../models/session-summary.model');
jest.mock('../learners.service', () => ({
  LearnerService: { invalidateCache: jest.fn() }
}));

describe('BookingsService', () => {
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 1);

  const pastDate = new Date();
  pastDate.setDate(pastDate.getDate() - 1);

  beforeEach(() => {
    jest.clearAllMocks();
    (SorobanEscrowService.isConfigured as jest.Mock).mockReturnValue(true);
    (db.connect as jest.Mock).mockResolvedValue(mockClient);
    mockClient.query.mockImplementation(async (sql: string, params?: any[]) => {
      if (typeof sql === 'string' && sql.includes('pg_try_advisory_xact_lock')) {
        return { rows: [{ locked: true }] };
      }
      return (db.query as jest.Mock)(sql, params);
    });
  });

  describe('createBooking', () => {
    it('creates a booking successfully', async () => {
      (db.query as jest.Mock).mockResolvedValue({
        rows: [
          { id: 'mentee-1', role: 'mentee', status: 'active' },
          { id: 'mentor-1', role: 'mentor', status: 'active' }
        ]
      });
      (BookingModel.checkConflict as jest.Mock).mockResolvedValue(false);
      (MentorsService.findById as jest.Mock).mockResolvedValue({ hourly_rate: 100 });
      (AssetExchangeService.getRate as jest.Mock).mockResolvedValue({ rate: '0.1' });
      (BookingModel.create as jest.Mock).mockResolvedValue({ id: 'booking-1' });

      const result = await BookingsService.createBooking({
        menteeId: 'mentee-1',
        mentorId: 'mentor-1',
        scheduledAt: futureDate,
        durationMinutes: 60,
        topic: 'Test'
      });

      expect(result.id).toBe('booking-1');
      expect(BookingModel.create).toHaveBeenCalledWith(expect.objectContaining({
        amount: '100.0000000',
        currency: 'XLM',
        usdEquivalent: '10.00'
      }));
    });

    it('throws 409 conflict if advisory lock cannot be acquired', async () => {
      mockClient.query.mockImplementation(async (sql: string) => {
        if (typeof sql === 'string' && sql.includes('pg_try_advisory_xact_lock')) {
          return { rows: [{ locked: false }] };
        }
        return { rows: [] };
      });

      await expect(
        BookingsService.createBooking({
          menteeId: 'mentee-1',
          mentorId: 'mentor-1',
          scheduledAt: futureDate,
          durationMinutes: 60,
          topic: 'Test',
        }),
      ).rejects.toMatchObject({
        statusCode: 409,
      });
    });

    it('throws if mentee is suspended', async () => {
      (db.query as jest.Mock).mockResolvedValue({
        rows: [
          { id: 'mentee-1', role: 'mentee', status: 'suspended' },
          { id: 'mentor-1', role: 'mentor', status: 'active' }
        ]
      });

      await expect(BookingsService.createBooking({
        menteeId: 'mentee-1',
        mentorId: 'mentor-1',
        scheduledAt: futureDate,
        durationMinutes: 60,
        topic: 'Test'
      })).rejects.toThrow('Your account is suspended');
    });
  });

  describe('getBookingById', () => {
    it('returns booking if user is mentee or mentor', async () => {
      (BookingModel.findById as jest.Mock).mockResolvedValue({
        id: 'booking-1',
        mentee_id: 'mentee-1',
        mentor_id: 'mentor-1'
      });

      const result = await BookingsService.getBookingById('booking-1', 'mentee-1');
      expect(result.id).toBe('booking-1');
    });

    it('throws if user is neither', async () => {
      (BookingModel.findById as jest.Mock).mockResolvedValue({
        id: 'booking-1',
        mentee_id: 'mentee-1',
        mentor_id: 'mentor-1'
      });

      await expect(BookingsService.getBookingById('booking-1', 'other-user')).rejects.toThrow('Access denied');
    });
  });

  describe('getUserBookings', () => {
    it('returns cached bookings if available', async () => {
      (CacheService.get as jest.Mock).mockResolvedValue({ bookings: [], total: 0 });
      
      const result = await BookingsService.getUserBookings('user-1');
      expect(result.total).toBe(0);
      expect(BookingModel.findByUserId).not.toHaveBeenCalled();
    });

    it('fetches from DB if cache miss', async () => {
      (CacheService.get as jest.Mock).mockResolvedValue(null);
      (BookingModel.findByUserId as jest.Mock).mockResolvedValue({ bookings: [{ id: 'b-1' }], total: 1 });
      
      const result = await BookingsService.getUserBookings('user-1');
      expect(result.total).toBe(1);
      expect(CacheService.set).toHaveBeenCalled();
    });

    it('bypasses the unfiltered cache for status-filtered bookings', async () => {
      const result = { bookings: [{ id: 'b-no-show', status: 'no_show' }], total: 1 };
      (CacheService.get as jest.Mock).mockResolvedValue({
        bookings: [{ id: 'b-confirmed', status: 'confirmed' }],
        total: 1,
      });
      (BookingModel.findByUserId as jest.Mock).mockResolvedValue(result);

      await expect(
        BookingsService.getUserBookings('user-1', { status: 'no_show' }),
      ).resolves.toEqual(result);

      expect(CacheService.get).not.toHaveBeenCalled();
      expect(BookingModel.findByUserId).toHaveBeenCalledWith('user-1', {
        status: 'no_show',
      });
      expect(CacheService.set).not.toHaveBeenCalled();
    });
  });

  describe('confirmBooking', () => {
    it('confirms pending paid booking by mentor', async () => {
      (BookingModel.findById as jest.Mock).mockResolvedValue({
        id: 'booking-1',
        mentee_id: 'mentee-1',
        mentor_id: 'mentor-1',
        status: 'pending',
        payment_status: 'paid',
        amount: '100',
        currency: 'XLM'
      });
      (SorobanEscrowService.createEscrow as jest.Mock).mockResolvedValue({
        contractAddress: 'CA123',
        escrowId: 'E123',
        txHash: 'hash123'
      });
      (BookingModel.update as jest.Mock).mockResolvedValue({ id: 'booking-1', updated_at: new Date() });
      (db.query as jest.Mock).mockResolvedValue({ rows: [] }); // For setBookingEscrowMetadata

      const result = await BookingsService.confirmBooking('booking-1', 'mentor-1');
      expect(result.id).toBe('booking-1');
      expect(BookingModel.update).toHaveBeenCalledWith('booking-1', { status: 'confirmed' });
      expect(SocketService.emitToUser).toHaveBeenCalledTimes(2);
    });
  });

  describe('completeBooking', () => {
    it('completes confirmed booking past end time', async () => {
      (BookingModel.findById as jest.Mock).mockResolvedValue({
        id: 'booking-1',
        mentee_id: 'mentee-1',
        mentor_id: 'mentor-1',
        status: 'confirmed',
        scheduled_at: pastDate,
        duration_minutes: 60
      });
      (db.query as jest.Mock).mockResolvedValue({
        rows: [{ escrow_id: 'E123', escrow_contract_address: 'CA123' }]
      });
      (BookingModel.update as jest.Mock).mockResolvedValue({ id: 'booking-1', updated_at: new Date() });

      const result = await BookingsService.completeBooking('booking-1', 'mentee-1');
      expect(result.id).toBe('booking-1');
      expect(SorobanEscrowService.releaseFunds).toHaveBeenCalled();
    });
  });

  describe('cancelBooking', () => {
    it('cancels pending booking and refunds', async () => {
      (BookingModel.findById as jest.Mock).mockResolvedValue({
        id: 'booking-1',
        mentee_id: 'mentee-1',
        mentor_id: 'mentor-1',
        status: 'pending',
        scheduled_at: futureDate,
        duration_minutes: 60,
        amount: '100',
        payment_status: 'paid'
      });
      (db.query as jest.Mock).mockResolvedValue({
        rows: [{ escrow_id: 'E123', escrow_contract_address: 'CA123' }]
      });
      (SorobanEscrowService.refund as jest.Mock).mockResolvedValue({ txHash: 'hash123' });
      (BookingModel.update as jest.Mock).mockResolvedValue({ id: 'booking-1', updated_at: new Date() });

      const result = await BookingsService.cancelBooking('booking-1', 'mentee-1');
      expect(result.id).toBe('booking-1');
      expect(SorobanEscrowService.refund).toHaveBeenCalled();
    });
  });

  describe('rescheduleBooking', () => {
    it('reschedules a booking successfully', async () => {
      (BookingModel.findById as jest.Mock).mockResolvedValue({
        id: 'booking-1',
        mentee_id: 'mentee-1',
        mentor_id: 'mentor-1',
        status: 'pending',
        duration_minutes: 60,
        notes: 'test'
      });
      (BookingModel.checkConflict as jest.Mock).mockResolvedValue(false);
      (BookingModel.update as jest.Mock).mockResolvedValue({ id: 'booking-1', updated_at: new Date() });

      const result = await BookingsService.rescheduleBooking('booking-1', 'mentee-1', futureDate);
      expect(result.id).toBe('booking-1');
    });
  });
});
