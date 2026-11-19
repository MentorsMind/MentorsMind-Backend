import { StripeService } from '../stripe.service';
import { BookingModel } from '../../models/booking.model';
import { EscrowModel } from '../../models/escrow.model';
import pool from '../../config/database';
import { logger } from '../../utils/logger.utils';

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
    connect: jest.fn(),
    release: jest.fn(),
  },
}));
jest.mock('../../models/booking.model', () => ({
  BookingModel: { findById: jest.fn() },
}));
jest.mock('../../models/escrow.model', () => ({
  EscrowModel: { create: jest.fn() },
}));
jest.mock('../../utils/logger.utils', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

const mockedPoolConnect = pool.connect as jest.Mock;
const mockedClientQuery = jest.fn();
const mockedClientRelease = jest.fn();

describe('StripeService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPoolConnect.mockResolvedValue({
      query: mockedClientQuery,
      release: mockedClientRelease,
    });
  });

  describe('handleEvent', () => {
    const mockEvent = {
      type: 'payment_intent.succeeded',
      id: 'evt_123',
      data: {
        object: {
          id: 'pi_456',
          metadata: {
            bookingId: 'booking-1',
            userId: 'user-1',
          },
          charges: {
            data: [{ id: 'ch_789' }],
          },
        },
      },
    };

    const mockCharge = {
      id: 'ch_789',
      amount: 1000,
      currency: 'usd',
      metadata: {},
    };

    beforeEach(() => {
      mockedClientQuery.mockReset();
    });

    it('marks booking as paid on payment_intent.succeeded', async () => {
      // Mock booking lookup
      ; (BookingModel.findById as jest.Mock).mockResolvedValue({
        id: 'booking-1',
        mentee_id: 'user-1',
        mentor_id: 'user-2',
      });

      // Mock escrow creation
      ; (EscrowModel.create as jest.Mock).mockResolvedValue({ id: 'escrow-1' });

      mockedClientQuery.mockImplementation(async (query: string) => ({
        rows: query.includes('INSERT INTO transactions') ? [{ id: 'tx-1' }] : [],
      }));

      await StripeService.handleEvent(mockEvent as any);

      expect(mockedClientQuery).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE transactions SET payment_rail = 'stripe' WHERE id = $1"),
        ['tx-1']
      );

      // Verify booking was marked as paid
      expect(mockedClientQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE bookings SET payment_status ='),
        expect.any(Array)
      );
    });

    it('ignores payment_intent.payment_failed (no booking update)', async () => {
      const failedEvent = {
        type: 'payment_intent.payment_failed',
        id: 'evt_456',
        data: {
          object: {
            metadata: {
              bookingId: 'booking-2',
              userId: 'user-2',
            },
          },
        },
      };

      await StripeService.handleEvent(failedEvent as any);

      // No UPDATE bookings should occur for unhandled event types
      const updateCalls = mockedClientQuery.mock.calls.filter(
        (call: any) => call[0].includes('UPDATE bookings')
      );
      expect(updateCalls.length).toBe(0);
    });

    it('ignores unknown event types gracefully', async () => {
      const unknownEvent = {
        type: 'unknown.event.type',
        id: 'evt_789',
      };

      await expect(
        StripeService.handleEvent(unknownEvent as any)
      ).resolves.not.toThrow();
    });
  });
});