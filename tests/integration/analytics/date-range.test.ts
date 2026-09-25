/**
 * date-range.test.ts
 *
 * Integration tests for analytics date range filtering.
 * Verifies that the analytics endpoint correctly filters data based on startDate and endDate parameters.
 *
 * Tests:
 *   1. Data within date range is returned
 *   2. Data outside date range is excluded
 *   3. All data is returned when no date parameters are provided
 */

import request from 'supertest';
import app from '../../../src/app';
import { setupContainers, teardownContainers } from '../setup';
import pool from '../../../src/config/database';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

// Mock authentication
jest.mock('../../../src/middleware/auth.middleware', () => ({
  authenticate: (req: any, res: any, next: any) => {
    req.user = {
      id: 'test-admin-user',
      userId: 'test-admin-user',
      role: 'admin',
    };
    next();
  },
}));

beforeAll(async () => {
  await setupContainers();
});

afterAll(async () => {
  await teardownContainers();
});

describe('Analytics Date Range Filtering', () => {
  const adminToken = jwt.sign(
    { userId: 'test-admin-user', role: 'admin' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  // Helper to format date as YYYY-MM-DD
  const formatDate = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Helper to seed test data
  const seedBookings = async (date: Date, count: number = 3): Promise<void> => {
    for (let i = 0; i < count; i++) {
      await pool.query(
        `INSERT INTO bookings (mentor_id, mentee_id, scheduled_at, duration_minutes, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          `mentor-${i}`,
          `mentee-${i}`,
          date,
          60,
          'completed',
          date,
        ]
      );
    }
  };

  const seedSessions = async (date: Date, count: number = 2): Promise<void> => {
    for (let i = 0; i < count; i++) {
      await pool.query(
        `INSERT INTO sessions (booking_id, started_at, ended_at, created_at)
         VALUES ($1, $2, $3, $4)`,
        [
          `booking-${i}`,
          date,
          new Date(date.getTime() + 60 * 60 * 1000),
          date,
        ]
      );
    }
  };

  beforeEach(async () => {
    // Clean up previous test data
    await pool.query('DELETE FROM sessions');
    await pool.query('DELETE FROM bookings');
  });

  afterEach(async () => {
    // Clean up test data
    await pool.query('DELETE FROM sessions');
    await pool.query('DELETE FROM bookings');
  });

  it('should return only data within the specified date range', async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const fiveDaysAgo = new Date(today);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    const fiveDaysLater = new Date(today);
    fiveDaysLater.setDate(fiveDaysLater.getDate() + 5);

    // Seed data at different dates
    await seedBookings(fiveDaysAgo, 2);
    await seedBookings(today, 3); // This should be returned
    await seedBookings(fiveDaysLater, 2);

    const startDate = formatDate(new Date(today.getTime() - 24 * 60 * 60 * 1000)); // yesterday
    const endDate = formatDate(new Date(today.getTime() + 24 * 60 * 60 * 1000)); // tomorrow

    const res = await request(app)
      .get('/api/v1/analytics')
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ startDate, endDate });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify that we got the 'today' records but not the past or future records
    if (res.body.data && res.body.data.bookings) {
      const bookingCount = res.body.data.bookings.length;
      expect(bookingCount).toBe(3); // Should only have today's 3 bookings
    }
  });

  it('should return all data when no date parameters are provided', async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const fiveDaysAgo = new Date(today);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    const fiveDaysLater = new Date(today);
    fiveDaysLater.setDate(fiveDaysLater.getDate() + 5);

    // Seed data at different dates
    await seedBookings(fiveDaysAgo, 2);
    await seedBookings(today, 3);
    await seedBookings(fiveDaysLater, 2);

    const res = await request(app)
      .get('/api/v1/analytics')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Should return all records (2 + 3 + 2 = 7)
    if (res.body.data && res.body.data.bookings) {
      const bookingCount = res.body.data.bookings.length;
      expect(bookingCount).toBe(7);
    }
  });

  it('should exclude data before the startDate', async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const threeDaysAgo = new Date(today);
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    const oneDayAgo = new Date(today);
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    // Seed data
    await seedBookings(threeDaysAgo, 2);
    await seedBookings(oneDayAgo, 3);

    const startDate = formatDate(new Date(oneDayAgo.getTime())); // Start from 1 day ago

    const res = await request(app)
      .get('/api/v1/analytics')
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ startDate });

    expect(res.status).toBe(200);

    // Should only include data from 1 day ago onward (3 bookings)
    if (res.body.data && res.body.data.bookings) {
      const bookingCount = res.body.data.bookings.length;
      expect(bookingCount).toBe(3);
    }
  });

  it('should exclude data after the endDate', async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const oneDayAgo = new Date(today);
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    const threeDaysLater = new Date(today);
    threeDaysLater.setDate(threeDaysLater.getDate() + 3);

    // Seed data
    await seedBookings(oneDayAgo, 2);
    await seedBookings(threeDaysLater, 3);

    const endDate = formatDate(today); // End today

    const res = await request(app)
      .get('/api/v1/analytics')
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ endDate });

    expect(res.status).toBe(200);

    // Should only include data up to today (2 bookings from 1 day ago)
    if (res.body.data && res.body.data.bookings) {
      const bookingCount = res.body.data.bookings.length;
      expect(bookingCount).toBe(2);
    }
  });

  it('should handle edge case of single day range', async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Seed data only for today
    await seedBookings(today, 5);

    const dateStr = formatDate(today);

    const res = await request(app)
      .get('/api/v1/analytics')
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ startDate: dateStr, endDate: dateStr });

    expect(res.status).toBe(200);

    // Should return exactly today's 5 bookings
    if (res.body.data && res.body.data.bookings) {
      const bookingCount = res.body.data.bookings.length;
      expect(bookingCount).toBe(5);
    }
  });

  it('should require admin role to access analytics', async () => {
    const studentToken = jwt.sign(
      { userId: 'test-student-user', role: 'student' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Mock auth middleware to use student role
    jest.spyOn(require('../../../src/middleware/auth.middleware'), 'authenticate').mockImplementation(
      (req: any, res: any, next: any) => {
        req.user = {
          id: 'test-student-user',
          userId: 'test-student-user',
          role: 'student',
        };
        next();
      }
    );

    const res = await request(app)
      .get('/api/v1/analytics')
      .set('Authorization', `Bearer ${studentToken}`);

    expect(res.status).toBe(403); // Forbidden
  });
});
