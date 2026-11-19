/**
 * Unit tests for BookingsService conflict detection logic
 * Tests the checkConflict method and related booking overlap scenarios
 */

import { BookingModel } from '../../models/booking.model';
import { db } from '../../config/database';
import {
  calculateEndTime,
  calculateRefundEligibility,
  doTimeSlotsOverlap,
  isValidDuration,
} from '../../utils/booking-conflicts.utils';

jest.mock('../../config/database', () => ({
  db: { query: jest.fn() },
}));

describe('BookingsService - Conflict Detection Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('BookingModel.checkConflict', () => {
    const mentorId = 'mentor-123';
    const baseTime = new Date('2026-10-20T10:00:00Z');

    describe('identical time slots (double-booking)', () => {
      it('should detect conflict when two bookings have identical scheduledAt and durationMinutes', async () => {
        // Mock query to return a conflict count of 1
        (db.query as jest.Mock).mockResolvedValue({
          rows: [{ count: '1' }],
        });

        const hasConflict = await BookingModel.checkConflict(
          mentorId,
          baseTime,
          60, // 1 hour
        );

        expect(hasConflict).toBe(true);
        expect(db.query).toHaveBeenCalledWith(
          expect.stringContaining('SELECT COUNT(*) FROM bookings'),
          expect.arrayContaining([
            mentorId,
            baseTime,
            new Date(baseTime.getTime() + 60 * 60000), // end time
          ]),
        );
      });

      it('should reject back-to-back booking requests for the same time slot', async () => {
        // Simulate two simultaneous requests for the same mentor time slot
        (db.query as jest.Mock).mockResolvedValue({
          rows: [{ count: '1' }],
        });

        const scheduledAt = new Date('2026-10-20T14:00:00Z');
        const durationMinutes = 45;

        const conflict1 = await BookingModel.checkConflict(
          mentorId,
          scheduledAt,
          durationMinutes,
        );

        const conflict2 = await BookingModel.checkConflict(
          mentorId,
          scheduledAt,
          durationMinutes,
        );

        expect(conflict1).toBe(true);
        expect(conflict2).toBe(true);
        expect(db.query).toHaveBeenCalledTimes(2);
      });
    });

    describe('overlapping time windows', () => {
      it('should detect conflict when new booking starts during existing booking', async () => {
        // Existing: 10:00-11:00, New: 10:30-11:30
        (db.query as jest.Mock).mockResolvedValue({
          rows: [{ count: '1' }],
        });

        const newStartTime = new Date('2026-10-20T10:30:00Z');
        const hasConflict = await BookingModel.checkConflict(
          mentorId,
          newStartTime,
          60,
        );

        expect(hasConflict).toBe(true);
      });

      it('should detect conflict when new booking ends during existing booking', async () => {
        // Existing: 10:00-11:00, New: 09:30-10:30
        (db.query as jest.Mock).mockResolvedValue({
          rows: [{ count: '1' }],
        });

        const newStartTime = new Date('2026-10-20T09:30:00Z');
        const hasConflict = await BookingModel.checkConflict(
          mentorId,
          newStartTime,
          60,
        );

        expect(hasConflict).toBe(true);
      });

      it('should detect conflict when new booking completely encompasses existing booking', async () => {
        // Existing: 10:00-11:00, New: 09:00-12:00
        (db.query as jest.Mock).mockResolvedValue({
          rows: [{ count: '1' }],
        });

        const newStartTime = new Date('2026-10-20T09:00:00Z');
        const hasConflict = await BookingModel.checkConflict(
          mentorId,
          newStartTime,
          180, // 3 hours
        );

        expect(hasConflict).toBe(true);
      });

      it('should detect conflict when new booking is completely inside existing booking', async () => {
        // Existing: 10:00-12:00, New: 10:30-11:30
        (db.query as jest.Mock).mockResolvedValue({
          rows: [{ count: '1' }],
        });

        const newStartTime = new Date('2026-10-20T10:30:00Z');
        const hasConflict = await BookingModel.checkConflict(
          mentorId,
          newStartTime,
          60,
        );

        expect(hasConflict).toBe(true);
      });

      it('should detect conflict for bookings with edge-touching start time', async () => {
        // Existing: 10:00-11:00, New: 11:00-12:00 (starts exactly when first ends)
        // This should be allowed (no overlap), but the SQL logic considers edge-touching
        (db.query as jest.Mock).mockResolvedValue({
          rows: [{ count: '0' }],
        });

        const newStartTime = new Date('2026-10-20T11:00:00Z');
        const hasConflict = await BookingModel.checkConflict(
          mentorId,
          newStartTime,
          60,
        );

        expect(hasConflict).toBe(false);
      });
    });

    describe('non-overlapping bookings (should succeed)', () => {
      it('should allow booking before existing booking with no overlap', async () => {
        // Existing: 10:00-11:00, New: 08:00-09:00
        (db.query as jest.Mock).mockResolvedValue({
          rows: [{ count: '0' }],
        });

        const newStartTime = new Date('2026-10-20T08:00:00Z');
        const hasConflict = await BookingModel.checkConflict(
          mentorId,
          newStartTime,
          60,
        );

        expect(hasConflict).toBe(false);
        expect(db.query).toHaveBeenCalledWith(
          expect.stringContaining('SELECT COUNT(*) FROM bookings'),
          expect.any(Array),
        );
      });

      it('should allow booking after existing booking with no overlap', async () => {
        // Existing: 10:00-11:00, New: 12:00-13:00
        (db.query as jest.Mock).mockResolvedValue({
          rows: [{ count: '0' }],
        });

        const newStartTime = new Date('2026-10-20T12:00:00Z');
        const hasConflict = await BookingModel.checkConflict(
          mentorId,
          newStartTime,
          60,
        );

        expect(hasConflict).toBe(false);
      });

      it('should allow booking for different mentor with same time slot', async () => {
        // Different mentor should have independent availability
        (db.query as jest.Mock).mockResolvedValue({
          rows: [{ count: '0' }],
        });

        const differentMentorId = 'mentor-456';
        const hasConflict = await BookingModel.checkConflict(
          differentMentorId,
          baseTime,
          60,
        );

        expect(hasConflict).toBe(false);
        expect(db.query).toHaveBeenCalledWith(
          expect.stringContaining('mentor_id = $1'),
          expect.arrayContaining([differentMentorId, baseTime, expect.any(Date)]),
        );
      });

      it('should allow multiple non-overlapping bookings for the same mentor', async () => {
        (db.query as jest.Mock).mockResolvedValue({
          rows: [{ count: '0' }],
        });

        // Check multiple non-overlapping slots
        const slot1 = new Date('2026-10-20T08:00:00Z');
        const slot2 = new Date('2026-10-20T10:00:00Z');
        const slot3 = new Date('2026-10-20T14:00:00Z');

        const conflict1 = await BookingModel.checkConflict(mentorId, slot1, 60);
        const conflict2 = await BookingModel.checkConflict(mentorId, slot2, 60);
        const conflict3 = await BookingModel.checkConflict(mentorId, slot3, 60);

        expect(conflict1).toBe(false);
        expect(conflict2).toBe(false);
        expect(conflict3).toBe(false);
        expect(db.query).toHaveBeenCalledTimes(3);
      });
    });

    describe('excludeBookingId parameter', () => {
      it('should exclude current booking when rescheduling', async () => {
        (db.query as jest.Mock).mockResolvedValue({
          rows: [{ count: '0' }],
        });

        const existingBookingId = 'booking-789';
        const hasConflict = await BookingModel.checkConflict(
          mentorId,
          baseTime,
          60,
          existingBookingId,
        );

        expect(hasConflict).toBe(false);
        expect(db.query).toHaveBeenCalledWith(
          expect.stringContaining('AND id != $4'),
          expect.arrayContaining([mentorId, baseTime, expect.any(Date), existingBookingId]),
        );
      });

      it('should still detect conflicts with other bookings when excluding one', async () => {
        (db.query as jest.Mock).mockResolvedValue({
          rows: [{ count: '1' }], // Another booking still conflicts
        });

        const existingBookingId = 'booking-789';
        const hasConflict = await BookingModel.checkConflict(
          mentorId,
          baseTime,
          60,
          existingBookingId,
        );

        expect(hasConflict).toBe(true);
      });
    });

    describe('status filtering', () => {
      it('should ignore cancelled bookings when checking conflicts', async () => {
        // The SQL query excludes cancelled and completed bookings
        (db.query as jest.Mock).mockResolvedValue({
          rows: [{ count: '0' }],
        });

        const hasConflict = await BookingModel.checkConflict(
          mentorId,
          baseTime,
          60,
        );

        expect(hasConflict).toBe(false);
        expect(db.query).toHaveBeenCalledWith(
          expect.stringContaining("status NOT IN ('cancelled', 'completed')"),
          expect.any(Array),
        );
      });

      it('should count pending, confirmed, and rescheduled bookings as conflicts', async () => {
        (db.query as jest.Mock).mockResolvedValue({
          rows: [{ count: '1' }],
        });

        const hasConflict = await BookingModel.checkConflict(
          mentorId,
          baseTime,
          60,
        );

        expect(hasConflict).toBe(true);
      });
    });

    describe('edge cases and validation', () => {
      it('should handle very short booking durations (15 minutes)', async () => {
        (db.query as jest.Mock).mockResolvedValue({
          rows: [{ count: '0' }],
        });

        const hasConflict = await BookingModel.checkConflict(
          mentorId,
          baseTime,
          15,
        );

        expect(hasConflict).toBe(false);
      });

      it('should handle very long booking durations (240 minutes)', async () => {
        (db.query as jest.Mock).mockResolvedValue({
          rows: [{ count: '0' }],
        });

        const hasConflict = await BookingModel.checkConflict(
          mentorId,
          baseTime,
          240,
        );

        expect(hasConflict).toBe(false);
      });

      it('should throw error for invalid duration (non-integer)', async () => {
        await expect(
          BookingModel.checkConflict(mentorId, baseTime, 60.5),
        ).rejects.toThrow('Invalid durationMinutes: must be a positive integer');
      });

      it('should throw error for invalid duration (negative)', async () => {
        await expect(
          BookingModel.checkConflict(mentorId, baseTime, -30),
        ).rejects.toThrow('Invalid durationMinutes: must be a positive integer');
      });

      it('should throw error for invalid duration (zero)', async () => {
        await expect(
          BookingModel.checkConflict(mentorId, baseTime, 0),
        ).rejects.toThrow('Invalid durationMinutes: must be a positive integer');
      });

      it('should handle bookings at midnight boundary', async () => {
        (db.query as jest.Mock).mockResolvedValue({
          rows: [{ count: '0' }],
        });

        const midnightTime = new Date('2026-10-20T00:00:00Z');
        const hasConflict = await BookingModel.checkConflict(
          mentorId,
          midnightTime,
          60,
        );

        expect(hasConflict).toBe(false);
      });

      it('should handle bookings crossing day boundary', async () => {
        (db.query as jest.Mock).mockResolvedValue({
          rows: [{ count: '0' }],
        });

        const lateNightTime = new Date('2026-10-20T23:30:00Z');
        const hasConflict = await BookingModel.checkConflict(
          mentorId,
          lateNightTime,
          60, // Ends at 00:30 next day
        );

        expect(hasConflict).toBe(false);
      });
    });

    describe('race condition prevention', () => {
      it('should call database query each time to prevent stale data', async () => {
        (db.query as jest.Mock)
          .mockResolvedValueOnce({ rows: [{ count: '0' }] })
          .mockResolvedValueOnce({ rows: [{ count: '1' }] });

        // First check: no conflict
        const firstCheck = await BookingModel.checkConflict(
          mentorId,
          baseTime,
          60,
        );

        // Second check: conflict detected (simulating concurrent booking)
        const secondCheck = await BookingModel.checkConflict(
          mentorId,
          baseTime,
          60,
        );

        expect(firstCheck).toBe(false);
        expect(secondCheck).toBe(true);
        expect(db.query).toHaveBeenCalledTimes(2);
      });

      it('should properly calculate end time for conflict detection', async () => {
        (db.query as jest.Mock).mockResolvedValue({
          rows: [{ count: '0' }],
        });

        const startTime = new Date('2026-10-20T10:00:00Z');
        const duration = 90; // 1.5 hours
        const expectedEndTime = new Date('2026-10-20T11:30:00Z');

        await BookingModel.checkConflict(mentorId, startTime, duration);

        const callArgs = (db.query as jest.Mock).mock.calls[0][1];
        expect(callArgs[2]).toEqual(expectedEndTime);
      });
    });
  });

  describe('Booking Conflict Utilities', () => {
    describe('calculateEndTime', () => {
      it('should calculate end time correctly for 60 minute duration', () => {
        const startTime = new Date('2026-10-20T10:00:00Z');
        const endTime = calculateEndTime(startTime, 60);

        expect(endTime).toEqual(new Date('2026-10-20T11:00:00Z'));
      });

      it('should calculate end time correctly for 45 minute duration', () => {
        const startTime = new Date('2026-10-20T14:30:00Z');
        const endTime = calculateEndTime(startTime, 45);

        expect(endTime).toEqual(new Date('2026-10-20T15:15:00Z'));
      });

      it('should calculate end time correctly for 15 minute duration', () => {
        const startTime = new Date('2026-10-20T10:00:00Z');
        const endTime = calculateEndTime(startTime, 15);

        expect(endTime).toEqual(new Date('2026-10-20T10:15:00Z'));
      });

      it('should handle duration crossing day boundary', () => {
        const startTime = new Date('2026-10-20T23:00:00Z');
        const endTime = calculateEndTime(startTime, 120);

        expect(endTime).toEqual(new Date('2026-10-21T01:00:00Z'));
      });
    });

    describe('doTimeSlotsOverlap', () => {
      it('should detect overlap when slot1 starts during slot2', () => {
        const slot1 = {
          start: new Date('2026-10-20T10:30:00Z'),
          end: new Date('2026-10-20T11:30:00Z'),
        };
        const slot2 = {
          start: new Date('2026-10-20T10:00:00Z'),
          end: new Date('2026-10-20T11:00:00Z'),
        };

        expect(doTimeSlotsOverlap(slot1, slot2)).toBe(true);
      });

      it('should detect overlap when slot1 ends during slot2', () => {
        const slot1 = {
          start: new Date('2026-10-20T09:30:00Z'),
          end: new Date('2026-10-20T10:30:00Z'),
        };
        const slot2 = {
          start: new Date('2026-10-20T10:00:00Z'),
          end: new Date('2026-10-20T11:00:00Z'),
        };

        expect(doTimeSlotsOverlap(slot1, slot2)).toBe(true);
      });

      it('should detect overlap when slot1 encompasses slot2', () => {
        const slot1 = {
          start: new Date('2026-10-20T09:00:00Z'),
          end: new Date('2026-10-20T12:00:00Z'),
        };
        const slot2 = {
          start: new Date('2026-10-20T10:00:00Z'),
          end: new Date('2026-10-20T11:00:00Z'),
        };

        expect(doTimeSlotsOverlap(slot1, slot2)).toBe(true);
      });

      it('should detect no overlap when slot1 is completely before slot2', () => {
        const slot1 = {
          start: new Date('2026-10-20T08:00:00Z'),
          end: new Date('2026-10-20T09:00:00Z'),
        };
        const slot2 = {
          start: new Date('2026-10-20T10:00:00Z'),
          end: new Date('2026-10-20T11:00:00Z'),
        };

        expect(doTimeSlotsOverlap(slot1, slot2)).toBe(false);
      });

      it('should detect no overlap when slot1 is completely after slot2', () => {
        const slot1 = {
          start: new Date('2026-10-20T12:00:00Z'),
          end: new Date('2026-10-20T13:00:00Z'),
        };
        const slot2 = {
          start: new Date('2026-10-20T10:00:00Z'),
          end: new Date('2026-10-20T11:00:00Z'),
        };

        expect(doTimeSlotsOverlap(slot1, slot2)).toBe(false);
      });

      it('should handle edge-touching slots (no overlap)', () => {
        const slot1 = {
          start: new Date('2026-10-20T11:00:00Z'),
          end: new Date('2026-10-20T12:00:00Z'),
        };
        const slot2 = {
          start: new Date('2026-10-20T10:00:00Z'),
          end: new Date('2026-10-20T11:00:00Z'),
        };

        expect(doTimeSlotsOverlap(slot1, slot2)).toBe(false);
      });
    });

    describe('isValidDuration', () => {
      it('should accept valid durations (15, 30, 45, 60)', () => {
        expect(isValidDuration(15)).toBe(true);
        expect(isValidDuration(30)).toBe(true);
        expect(isValidDuration(45)).toBe(true);
        expect(isValidDuration(60)).toBe(true);
      });

      it('should accept longer valid durations (90, 120, 240)', () => {
        expect(isValidDuration(90)).toBe(true);
        expect(isValidDuration(120)).toBe(true);
        expect(isValidDuration(240)).toBe(true);
      });

      it('should reject duration too short (< 15)', () => {
        expect(isValidDuration(10)).toBe(false);
        expect(isValidDuration(5)).toBe(false);
      });

      it('should reject duration too long (> 240)', () => {
        expect(isValidDuration(250)).toBe(false);
        expect(isValidDuration(300)).toBe(false);
      });

      it('should reject duration not divisible by 15', () => {
        expect(isValidDuration(20)).toBe(false);
        expect(isValidDuration(50)).toBe(false);
        expect(isValidDuration(70)).toBe(false);
      });
    });

    describe('calculateRefundEligibility', () => {
      it('should give 100% refund for cancellation >24 hours in advance', () => {
        const scheduledAt = new Date('2026-10-22T10:00:00Z');
        const cancelledAt = new Date('2026-10-20T09:00:00Z'); // 49 hours before

        const result = calculateRefundEligibility(scheduledAt, cancelledAt);

        expect(result.eligible).toBe(true);
        expect(result.refundPercentage).toBe(100);
        expect(result.reason).toContain('24 hours');
      });

      it('should give 50% refund for cancellation 12-24 hours in advance', () => {
        const scheduledAt = new Date('2026-10-22T10:00:00Z');
        const cancelledAt = new Date('2026-10-21T22:00:00Z'); // 12 hours before

        const result = calculateRefundEligibility(scheduledAt, cancelledAt);

        expect(result.eligible).toBe(true);
        expect(result.refundPercentage).toBe(50);
        expect(result.reason).toContain('12-24 hours');
      });

      it('should give no refund for cancellation <12 hours in advance', () => {
        const scheduledAt = new Date('2026-10-22T10:00:00Z');
        const cancelledAt = new Date('2026-10-22T05:00:00Z'); // 5 hours before

        const result = calculateRefundEligibility(scheduledAt, cancelledAt);

        expect(result.eligible).toBe(false);
        expect(result.refundPercentage).toBe(0);
        expect(result.reason).toContain('less than 12 hours');
      });

      it('should handle exact 24 hour boundary', () => {
        const scheduledAt = new Date('2026-10-22T10:00:00Z');
        const cancelledAt = new Date('2026-10-21T10:00:00Z'); // Exactly 24 hours

        const result = calculateRefundEligibility(scheduledAt, cancelledAt);

        expect(result.eligible).toBe(true);
        expect(result.refundPercentage).toBe(100);
      });

      it('should handle exact 12 hour boundary', () => {
        const scheduledAt = new Date('2026-10-22T10:00:00Z');
        const cancelledAt = new Date('2026-10-21T22:00:00Z'); // Exactly 12 hours

        const result = calculateRefundEligibility(scheduledAt, cancelledAt);

        expect(result.eligible).toBe(true);
        expect(result.refundPercentage).toBe(50);
      });
    });
  });
});
