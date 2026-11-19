import { setupContainers, teardownContainers } from '../setup';
import { BookingsService } from '../../../src/services/bookings.service';
import { BookingModel } from '../../../src/models/booking.model';
import { MentorsService } from '../../../src/services/mentors.service';
import { db } from '../../../src/config/database';
import { ErrorCode } from '../../../src/errors/error-codes';
import pool from '../../../src/config/database';
import { EventStoreService } from '../../../src/services/event-store.service';

describe('Concurrent Booking Locks Integration', () => {
  let originalConnect: any;

  beforeAll(async () => {
    await setupContainers();

    // Mock db.connect to intercept the users query so we don't need migrations
    originalConnect = db.connect;
    jest.spyOn(db, 'connect').mockImplementation(async () => {
      // Must use the exported pool from config/database to get a real connection
      const actualClient = await pool.connect();
      const originalQuery = actualClient.query.bind(actualClient);
      
      actualClient.query = async (text: string, params?: any) => {
        if (text.includes('SELECT id, role, status FROM users')) {
          return {
            rows: [
              { id: 'mentee-1', role: 'mentee', status: 'active' },
              { id: 'mentor-1', role: 'mentor', status: 'active' }
            ]
          };
        }
        return originalQuery(text, params);
      } as any;
      
      return actualClient;
    });
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await teardownContainers();
  });

  it('should result in one success and one 409 conflict when booking concurrently', async () => {
    let created = false;
    let createCount = 0;

    jest.spyOn(BookingModel, 'checkConflict').mockImplementation(async () => {
      const current = created;
      // Add a delay to guarantee a race condition if locks were not present
      await new Promise(resolve => setTimeout(resolve, 500));
      return current;
    });

    jest.spyOn(BookingModel, 'create').mockImplementation(async () => {
      created = true;
      createCount++;
      return { id: `mock-booking-id-${createCount}` } as any;
    });

    jest.spyOn(MentorsService, 'findById').mockResolvedValue({
      hourly_rate: 50
    } as any);

    jest.spyOn(EventStoreService, 'publishEvent').mockResolvedValue(undefined);

    const date = new Date();
    date.setDate(date.getDate() + 1); // Tomorrow
    
    const request1 = BookingsService.createBooking({
      menteeId: 'mentee-1',
      mentorId: 'mentor-1',
      scheduledAt: date,
      durationMinutes: 60,
      topic: 'Concurrency Test'
    });

    const request2 = BookingsService.createBooking({
      menteeId: 'mentee-1',
      mentorId: 'mentor-1',
      scheduledAt: date,
      durationMinutes: 60,
      topic: 'Concurrency Test 2'
    });

    const results = await Promise.allSettled([request1, request2]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    
    const error = (rejected[0] as PromiseRejectedResult).reason;
    expect(error.code).toBe(ErrorCode.BOOKING_CONFLICT);
    expect(error.statusCode).toBe(409);
    
    expect(createCount).toBe(1);
  }, 15000); // Allow up to 15 seconds for this test
});
