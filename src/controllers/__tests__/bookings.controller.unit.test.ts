jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../services/users.service', () => ({
  UsersService: {
    findById: jest.fn(),
  },
}));

jest.mock('../../services/meeting.service', () => ({
  MeetingService: {
    createMeetingRoom: jest.fn(),
  },
}));

jest.mock('../../services/notification.service', () => ({
  NotificationService: {
    sendMeetingUrlNotification: jest.fn(),
  },
}));

jest.mock('../../services/bookings.service', () => ({
  BookingsService: {
    listBookings: jest.fn(),
    createBooking: jest.fn(),
  },
}));

jest.mock('../../services/event-store.service', () => ({
  EventStoreService: {
    getEventHistory: jest.fn(),
  },
}));

jest.mock('../../models/session.model', () => ({
  SessionModel: {
    findUpcomingByUserId: jest.fn(),
    findByUserIdPaginated: jest.fn(),
  },
}));

import { Request, Response } from 'express';
import { BookingsController } from '../bookings.controller';
import { BookingsService } from '../../services/bookings.service';
import { SessionModel } from '../../models/session.model';

describe('BookingsController - listBookings pagination and total count', () => {
  let mockReq: Partial<any>;
  let mockRes: Partial<Response>;
  let nextFn: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockReq = {
      params: {},
      query: {},
      body: {},
      user: { id: 'user-123', userId: 'user-123', role: 'mentee' },
    };

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    nextFn = jest.fn();
  });

  it('includes total in the ResponseUtil.success meta parameter (e.g. meta.total: 47)', async () => {
    const mockBookings = [
      { id: 'b-1', topic: 'Architecture Review', status: 'confirmed' },
      { id: 'b-2', topic: 'Career Mentoring', status: 'pending' },
    ];

    (BookingsService.listBookings as jest.Mock).mockResolvedValueOnce({
      bookings: mockBookings,
      total: 47,
    });

    mockReq.query = { page: '2', limit: '10' };

    await BookingsController.listBookings(mockReq as any, mockRes as Response, nextFn);

    expect(BookingsService.listBookings).toHaveBeenCalledWith('user-123', {
      status: undefined,
      cursor: undefined,
      page: 2,
      limit: 10,
    });

    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'success',
        meta: expect.objectContaining({
          total: 47,
          page: 2,
          limit: 10,
          totalPages: 5,
          hasNext: true,
          hasPrev: true,
        }),
      }),
    );
  });

  it('returns unauthorized error when user is not present on request', async () => {
    mockReq.user = undefined;

    await BookingsController.listBookings(mockReq as any, mockRes as Response, nextFn);

    expect(mockRes.status).toHaveBeenCalledWith(401);
  });

  it('handles upcoming sessions shortcut correctly', async () => {
    mockReq.query = { upcoming: 'true' };
    (SessionModel.findUpcomingByUserId as jest.Mock).mockResolvedValueOnce([
      { id: 's-1', status: 'confirmed', meeting_url: 'https://meet.com/abc' },
    ]);

    await BookingsController.listBookings(mockReq as any, mockRes as Response, nextFn);

    expect(SessionModel.findUpcomingByUserId).toHaveBeenCalledWith('user-123');
    expect(mockRes.status).toHaveBeenCalledWith(200);
  });
});
