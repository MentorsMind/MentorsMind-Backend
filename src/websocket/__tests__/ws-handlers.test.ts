// Mock pg and pg-pool to prevent DB connection attempts from global setup
jest.mock('pg', () => {
  const mPool = {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    end: jest.fn().mockResolvedValue(undefined),
    connect: jest.fn(),
    on: jest.fn(),
  };
  return { Pool: jest.fn(() => mPool) };
});
jest.mock('pg-pool', () => {
  return jest.fn().mockImplementation(() => ({
    query: jest.fn().mockResolvedValue({ rows: [] }),
    end: jest.fn().mockResolvedValue(undefined),
    connect: jest.fn(),
    on: jest.fn(),
  }));
});

import { WsService } from '../../services/ws.service';
import {
  notifyBookingConfirmed,
  notifyBookingCancelled,
  notifySessionStatus,
} from '../ws-handlers/notification.handler';
import {
  notifyPaymentStatus,
  notifyEscrowUpdate,
} from '../ws-handlers/payment.handler';

jest.mock('../../services/ws.service', () => ({
  WsService: { publish: jest.fn() },
}));

const mockPublish = WsService.publish as jest.Mock;

beforeEach(() => mockPublish.mockResolvedValue(undefined));
afterEach(() => jest.clearAllMocks());

describe('notification.handler', () => {
  const base = {
    bookingId: 'b1',
    mentorId: 'mentor-1',
    menteeId: 'mentee-1',
    scheduledAt: '2026-04-01T10:00:00Z',
    topic: 'TypeScript',
    status: 'confirmed',
  };

  it('notifyBookingConfirmed publishes to both mentor and mentee', async () => {
    await notifyBookingConfirmed(base);
    expect(mockPublish).toHaveBeenCalledTimes(2);
    expect(mockPublish).toHaveBeenCalledWith(
      'mentee-1',
      'booking:confirmed',
      expect.any(Object),
    );
    expect(mockPublish).toHaveBeenCalledWith(
      'mentor-1',
      'booking:new',
      expect.any(Object),
    );
  });

  it('notifyBookingCancelled publishes to both parties', async () => {
    await notifyBookingCancelled({ ...base, status: 'cancelled' });
    expect(mockPublish).toHaveBeenCalledTimes(2);
    expect(mockPublish).toHaveBeenCalledWith(
      'mentee-1',
      'booking:cancelled',
      expect.any(Object),
    );
    expect(mockPublish).toHaveBeenCalledWith(
      'mentor-1',
      'booking:cancelled',
      expect.any(Object),
    );
  });

  it('notifySessionStatus publishes to the specified user', async () => {
    await notifySessionStatus({
      sessionId: 's1',
      userId: 'user-1',
      status: 'confirmed',
      meetingUrl: 'https://meet.example.com',
    });
    expect(mockPublish).toHaveBeenCalledWith('user-1', 'session:status', {
      sessionId: 's1',
      status: 'confirmed',
      meetingUrl: 'https://meet.example.com',
    });
  });
});

describe('payment.handler', () => {
  it('notifyPaymentStatus publishes to the user', async () => {
    await notifyPaymentStatus({
      transactionId: 'tx1',
      bookingId: 'b1',
      userId: 'user-1',
      status: 'completed',
      amount: '50.0000000',
      currency: 'XLM',
    });
    expect(mockPublish).toHaveBeenCalledWith(
      'user-1',
      'payment:status',
      expect.objectContaining({ status: 'completed' }),
    );
  });

  it('notifyEscrowUpdate publishes to both mentor and mentee', async () => {
    await notifyEscrowUpdate({
      escrowId: 'e1',
      bookingId: 'b1',
      mentorId: 'mentor-1',
      menteeId: 'mentee-1',
      status: 'released',
      amount: '50.0000000',
    });
    expect(mockPublish).toHaveBeenCalledTimes(2);
    expect(mockPublish).toHaveBeenCalledWith(
      'mentor-1',
      'escrow:update',
      expect.any(Object),
    );
    expect(mockPublish).toHaveBeenCalledWith(
      'mentee-1',
      'escrow:update',
      expect.any(Object),
    );
  });
});
