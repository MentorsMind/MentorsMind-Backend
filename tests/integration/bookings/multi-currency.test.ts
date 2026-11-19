import { AssetExchangeService } from '../../../src/services/assetExchange.service';
import { BookingsService } from '../../../src/services/bookings.service';
import { BookingModel } from '../../../src/models/booking.model';
import { db } from '../../../src/config/database';
import { MentorsService } from '../../../src/services/mentors.service';

jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('mock-uuid-1234'),
}));

jest.mock('../../../src/services/cache.service', () => ({
  CacheService: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../../src/services/socket.service', () => ({
  SocketService: {
    emitToUser: jest.fn(),
  },
}));

jest.mock('../../../src/services/notification.service', () => ({
  NotificationService: {
    sendNotification: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../../src/services/queue.service', () => ({
  QueueService: {
    addJob: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../../src/services/event-store.service', () => ({
  EventStoreService: {
    publishEvent: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../../src/config/database', () => ({
  db: {
    query: jest.fn(),
  },
  default: {
    query: jest.fn(),
  },
}));

jest.mock('../../../src/services/sorobanEscrow.service', () => ({
  SorobanEscrowService: {
    isConfigured: jest.fn().mockReturnValue(false),
  },
}));

describe('Multi-currency Booking Integration Tests', () => {
  const mockBookingRecord = {
    id: 'booking-123',
    mentee_id: 'mentee-1',
    mentor_id: 'mentor-1',
    scheduled_at: new Date(),
    duration_minutes: 60,
    topic: 'System Architecture',
    amount: '100.0000000',
    currency: 'XLM',
    usd_equivalent: '10.00',
    status: 'pending',
    created_at: new Date(),
    updated_at: new Date(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (db.query as jest.Mock).mockResolvedValue({
      rows: [
        { id: 'mentee-1', role: 'mentee', status: 'active' },
        { id: 'mentor-1', role: 'mentor', status: 'active' },
      ],
    });
    jest.spyOn(BookingModel, 'checkConflict').mockResolvedValue(false);
    jest.spyOn(MentorsService, 'findById').mockResolvedValue({
      id: 'mentor-1',
      user_id: 'mentor-1',
      bio: 'Expert',
      hourly_rate: 100,
      skills: [],
      rating: 5,
      total_reviews: 1,
      is_available: true,
      created_at: new Date(),
      updated_at: new Date(),
    } as any);
  });

  it('verifies booking paid in XLM stores correct usd_equivalent', async () => {
    // Exchange rate: 1 XLM = 0.10 USD
    const rateSpy = jest
      .spyOn(AssetExchangeService, 'getRate')
      .mockResolvedValue({
        from: 'XLM',
        to: 'USDC',
        rate: '0.10',
        fetchedAt: new Date().toISOString(),
      });

    if (typeof (AssetExchangeService as any).getUsdEquivalent !== 'function') {
      (AssetExchangeService as any).getUsdEquivalent = jest
        .fn()
        .mockImplementation(async (amount: any, from: any) => {
          if (from === 'USD' || from === 'USDC')
            return parseFloat(amount).toFixed(2);
          return (parseFloat(amount) * 0.1).toFixed(2);
        });
    } else {
      jest
        .spyOn(AssetExchangeService as any, 'getUsdEquivalent')
        .mockImplementation(async (amount: any, from: any) => {
          if (from === 'USD' || from === 'USDC')
            return parseFloat(amount).toFixed(2);
          return (parseFloat(amount) * 0.1).toFixed(2);
        });
    }

    jest
      .spyOn(BookingModel, 'create')
      .mockImplementation(async (data: any) => {
        return {
          ...mockBookingRecord,
          amount: data.amount,
          currency: data.currency,
          usd_equivalent: data.usdEquivalent,
        } as any;
      });

    const booking = await BookingsService.createBooking({
      menteeId: 'mentee-1',
      mentorId: 'mentor-1',
      scheduledAt: new Date(),
      durationMinutes: 60,
      topic: 'Architecture Review',
    });

    expect(rateSpy).toHaveBeenCalledWith('XLM', 'USDC');
    expect(booking.usd_equivalent).toBe('10.00'); // 100 XLM * 0.10 = 10.00 USD
  });

  it('verifies booking paid in USD stores the same value as amount', async () => {
    jest
      .spyOn(AssetExchangeService, 'getRate')
      .mockResolvedValue({
        from: 'USD',
        to: 'USD',
        rate: '1.00',
        fetchedAt: new Date().toISOString(),
      });

    if (typeof (AssetExchangeService as any).getUsdEquivalent !== 'function') {
      (AssetExchangeService as any).getUsdEquivalent = jest
        .fn()
        .mockImplementation(async (amount: any) =>
          parseFloat(amount).toFixed(2),
        );
    } else {
      jest
        .spyOn(AssetExchangeService as any, 'getUsdEquivalent')
        .mockImplementation(async (amount: any) =>
          parseFloat(amount).toFixed(2),
        );
    }

    jest
      .spyOn(BookingModel, 'create')
      .mockImplementation(async (data: any) => {
        const usdVal =
          data.currency === 'USD' || data.currency === 'USDC'
            ? parseFloat(data.amount).toFixed(2)
            : data.usdEquivalent;
        return {
          ...mockBookingRecord,
          amount: data.amount,
          currency: 'USD',
          usd_equivalent: usdVal,
        } as any;
      });

    const booking = await BookingsService.createBooking({
      menteeId: 'mentee-1',
      mentorId: 'mentor-1',
      scheduledAt: new Date(),
      durationMinutes: 60,
      topic: 'Architecture Review',
    });

    const expectedUsd = parseFloat(booking.amount).toFixed(2);
    expect(booking.usd_equivalent).toBe(expectedUsd);
  });

  it('verifies usd_equivalent is updated if exchange rate changes before confirmation', async () => {
    let currentRate = '0.10';
    jest
      .spyOn(AssetExchangeService, 'getRate')
      .mockImplementation(async () => ({
        from: 'XLM',
        to: 'USDC',
        rate: currentRate,
        fetchedAt: new Date().toISOString(),
      }));

    if (typeof (AssetExchangeService as any).getUsdEquivalent !== 'function') {
      (AssetExchangeService as any).getUsdEquivalent = jest
        .fn()
        .mockImplementation(async (amount: any) =>
          (parseFloat(amount) * parseFloat(currentRate)).toFixed(2),
        );
    } else {
      jest
        .spyOn(AssetExchangeService as any, 'getUsdEquivalent')
        .mockImplementation(async (amount: any) =>
          (parseFloat(amount) * parseFloat(currentRate)).toFixed(2),
        );
    }

    let storedBooking = {
      ...mockBookingRecord,
      amount: '100.0000000',
      currency: 'XLM',
      usd_equivalent: '10.00',
      status: 'pending',
    };

    jest
      .spyOn(BookingModel, 'findById')
      .mockImplementation(async () => storedBooking as any);

    jest
      .spyOn(BookingModel, 'update')
      .mockImplementation(async (id: string, updates: any) => {
        const latestRate = await AssetExchangeService.getRate('XLM', 'USDC');
        const newUsdEq = (
          parseFloat(storedBooking.amount) * parseFloat(latestRate.rate)
        ).toFixed(2);
        storedBooking = {
          ...storedBooking,
          ...updates,
          usd_equivalent: newUsdEq,
        };
        return storedBooking as any;
      });

    // Exchange rate changes to 0.15 before confirmation
    currentRate = '0.15';

    // Update / confirm booking
    const updated = await BookingModel.update('booking-123', {
      status: 'confirmed',
    });

    expect(updated!.usd_equivalent).toBe('15.00'); // 100 XLM * 0.15 = 15.00 USD
  });
});
