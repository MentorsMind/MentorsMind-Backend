import { BookingsService } from '../bookings.service';
import { SorobanEscrowService } from '../sorobanEscrow.service';
import { db } from '../../config/database';
import { CacheService } from '../cache.service';
import { createError } from '../../middleware/errorHandler';
import { ErrorCode } from '../../errors/error-codes';

jest.mock('../../config/database', () => ({
  db: { query: jest.fn() },
  pool: { query: jest.fn() }
}));

jest.mock('../sorobanEscrow.service', () => ({
  ...jest.requireActual('../sorobanEscrow.service'),
  isConfigured: jest.fn(),
  createEscrow: jest.fn()
}));

describe('BookingsService confirmBooking', () => {
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 1);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('successful confirmation creates escrow', () => {
    it('confirms booking and creates escrow when Soroban is configured', async () => {
      // Mock booking retrieval
      ;(db.query as jest.Mock).mockResolvedValueOnce({
        rows: [{
          id: 'booking-1',
          mentee_id: 'mentee-1',
          mentor_id: 'mentor-1',
          scheduled_at: futureDate,
          duration_minutes: 60,
          status: 'pending',
          payment_status: 'paid',
          amount: '100',
          currency: 'XLM'
        }]
      });

      // Mock soroban escrow creation
      ;(SorobanEscrowService.isConfigured as jest.Mock).mockReturnValue(true);
      ;(SorobanEscrowService.createEscrow as jest.Mock).mockResolvedValue({
        contractAddress: '0x1234567890abcdef',
        escrowId: 'escrow-1',
        txHash: 'tx-1'
      });

      const result = await BookingsService.confirmBooking('booking-1', 'mentor-1');

      expect(result.status).toBe('confirmed');
      expect(SorobanEscrowService.createEscrow).toHaveBeenCalledWith(
        expect.objectContaining({
          bookingId: 'booking-1',
          learnerId: 'mentee-1',
          mentorId: 'mentor-1',
          amount: '100',
          currency: 'XLM'
        })
      );
      expect(result.escrow_contract_address).toBe('0x1234567890abcdef');
      expect(result.escrow_id).toBe('escrow-1');
    });

    it('confirms booking without escrow when not configured', async () => {
      ;(db.query as jest.Mock).mockResolvedValueOnce({
        rows: [{
          id: 'booking-1',
          mentee_id: 'mentee-1',
          mentor_id: 'mentor-1',
          scheduled_at: futureDate,
          duration_minutes: 60,
          status: 'pending',
          payment_status: 'paid',
          amount: '100',
          currency: 'XLM'
        }]
      });

      ;(SorobanEscrowService.isConfigured as jest.Mock).mockReturnValue(false);

      const result = await BookingsService.confirmBooking('booking-1', 'mentor-1');

      expect(result.status).toBe('confirmed');
      expect(result.escrow_contract_address).toBeNull();
      expect(result.escrow_id).toBeNull();
    });
  });

  describe('escrow failure rolls back to pending', () => {
    it('reverts booking status to pending if escrow creation throws', async () => {
      ;(db.query as jest.Mock).mockResolvedValueOnce({
        rows: [{
          id: 'booking-1',
 mentee_id: 'mentee-1',
          mentor_id: 'mentor-1',
          scheduled_at: futureDate,
          duration_minutes: 60,
          status: 'pending',
          payment_status: 'paid',
          amount: '100',
          currency: 'XLM'
        }]
      });

      ;(SorobanEscrowService.isConfigured as jest.Mock).mockReturnValue(true);
      ;(SorobanEscrowService.createEscrow as jest.Mock).mockRejectedValue(
        new Error('Soroban network error')
      );

      await expect(
        BookingsService.confirmBooking('booking-1', 'mentor-1')
      ).rejects.toThrow('Soroban network error');

      // Verify booking status was reverted to pending after escrow failure
      const { rows: updatedBooking } = await db.query(
        `SELECT status FROM bookings WHERE id = 'booking-1'`
      );
      expect(updatedBooking[0].status).toBe('pending');
    });
  });

  describe('escrow skipped when ESCROW_ENABLED=false', () => {
    it('skips escrow creation when ESCROW_ENABLED is false', async () => {
      ;(db.query as jest.Mock).mockResolvedValueOnce({
        rows: [{
          id: 'booking-1',
 mentee_id: 'mentee-1',
          mentor_id: 'mentor-1',
          scheduled_at: futureDate,
          duration_minutes: 60,
          status: 'pending',
          payment_status: 'paid',
          amount: '100',
          currency: 'XLM'
        }]
      });

      ;(SorobanEscrowService.isConfigured as jest.Mock).mockReturnValue(
        process.env.ESCROW_ENABLED === 'false'
      );

      const result = await BookingsService.confirmBooking('booking-1', 'mentor-1');

      expect(result.status).toBe('confirmed');
      expect(result.escrow_contract_address).toBeNull();
      expect(result.escrow_id).toBeNull();
    });
  });
});