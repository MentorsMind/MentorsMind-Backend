import {
  doTimeSlotsOverlap,
  calculateEndTime,
  isBookingInFuture,
  isWithinBusinessHours,
  isValidDuration,
  calculateRefundEligibility,
} from '../booking-conflicts.utils';

describe('Booking Conflicts Utils', () => {
  describe('doTimeSlotsOverlap', () => {
    it('should detect overlap when slot1 starts before slot2 and ends during slot2', () => {
      const slot1 = {
        start: new Date('2026-03-25T14:00:00Z'),
        end: new Date('2026-03-25T15:30:00Z'),
      };
      const slot2 = {
        start: new Date('2026-03-25T15:00:00Z'),
        end: new Date('2026-03-25T16:00:00Z'),
      };

      expect(doTimeSlotsOverlap(slot1, slot2)).toBe(true);
    });

    it('should detect overlap when slot1 is completely within slot2', () => {
      const slot1 = {
        start: new Date('2026-03-25T14:30:00Z'),
        end: new Date('2026-03-25T15:30:00Z'),
      };
      const slot2 = {
        start: new Date('2026-03-25T14:00:00Z'),
        end: new Date('2026-03-25T16:00:00Z'),
      };

      expect(doTimeSlotsOverlap(slot1, slot2)).toBe(true);
    });

    it('should not detect overlap when slots are adjacent', () => {
      const slot1 = {
        start: new Date('2026-03-25T14:00:00Z'),
        end: new Date('2026-03-25T15:00:00Z'),
      };
      const slot2 = {
        start: new Date('2026-03-25T15:00:00Z'),
        end: new Date('2026-03-25T16:00:00Z'),
      };

      expect(doTimeSlotsOverlap(slot1, slot2)).toBe(false);
    });

    it('should not detect overlap when slots are separate', () => {
      const slot1 = {
        start: new Date('2026-03-25T14:00:00Z'),
        end: new Date('2026-03-25T15:00:00Z'),
      };
      const slot2 = {
        start: new Date('2026-03-25T16:00:00Z'),
        end: new Date('2026-03-25T17:00:00Z'),
      };

      expect(doTimeSlotsOverlap(slot1, slot2)).toBe(false);
    });
  });

  describe('calculateEndTime', () => {
    it('should calculate end time correctly', () => {
      const start = new Date('2026-03-25T14:00:00Z');
      const duration = 60;

      const end = calculateEndTime(start, duration);

      expect(end.toISOString()).toBe('2026-03-25T15:00:00.000Z');
    });

    it('should handle fractional hours', () => {
      const start = new Date('2026-03-25T14:00:00Z');
      const duration = 90;

      const end = calculateEndTime(start, duration);

      expect(end.toISOString()).toBe('2026-03-25T15:30:00.000Z');
    });
  });

  describe('isBookingInFuture', () => {
    it('should return true for future bookings', () => {
      const futureDate = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours from now

      expect(isBookingInFuture(futureDate)).toBe(true);
    });

    it('should return false for past bookings', () => {
      const pastDate = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago

      expect(isBookingInFuture(pastDate)).toBe(false);
    });

    it('should respect buffer time', () => {
      const nearFutureDate = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes from now

      expect(isBookingInFuture(nearFutureDate, 30)).toBe(false);
      expect(isBookingInFuture(nearFutureDate, 10)).toBe(true);
    });
  });

  describe('isWithinBusinessHours', () => {
    it('should return true for weekday business hours', () => {
      const weekdayMorning = new Date('2026-03-25T10:00:00Z'); // Wednesday 10 AM

      expect(isWithinBusinessHours(weekdayMorning)).toBe(true);
    });

    it('should return false for weekends', () => {
      const saturday = new Date('2026-03-28T10:00:00Z'); // Saturday

      expect(isWithinBusinessHours(saturday)).toBe(false);
    });

    it('should return false for early morning', () => {
      const earlyMorning = new Date('2026-03-25T06:00:00Z'); // 6 AM

      expect(isWithinBusinessHours(earlyMorning)).toBe(false);
    });

    it('should return false for late evening', () => {
      const lateEvening = new Date('2026-03-25T21:00:00Z'); // 9 PM

      expect(isWithinBusinessHours(lateEvening)).toBe(false);
    });
  });

  describe('isValidDuration', () => {
    it('should accept valid durations', () => {
      expect(isValidDuration(15)).toBe(true);
      expect(isValidDuration(30)).toBe(true);
      expect(isValidDuration(60)).toBe(true);
      expect(isValidDuration(120)).toBe(true);
      expect(isValidDuration(240)).toBe(true);
    });

    it('should reject durations not in 15-minute increments', () => {
      expect(isValidDuration(20)).toBe(false);
      expect(isValidDuration(45)).toBe(false);
      expect(isValidDuration(70)).toBe(false);
    });

    it('should reject durations outside valid range', () => {
      expect(isValidDuration(10)).toBe(false);
      expect(isValidDuration(300)).toBe(false);
    });
  });

  describe('calculateRefundEligibility', () => {
    it('should give 100% refund for 24+ hours notice', () => {
      const scheduledAt = new Date(Date.now() + 25 * 60 * 60 * 1000); // 25 hours from now
      const cancelledAt = new Date();

      const result = calculateRefundEligibility(scheduledAt, cancelledAt);

      expect(result.eligible).toBe(true);
      expect(result.refundPercentage).toBe(100);
    });

    it('should give 50% refund for 12-24 hours notice', () => {
      const scheduledAt = new Date(Date.now() + 18 * 60 * 60 * 1000); // 18 hours from now
      const cancelledAt = new Date();

      const result = calculateRefundEligibility(scheduledAt, cancelledAt);

      expect(result.eligible).toBe(true);
      expect(result.refundPercentage).toBe(50);
    });

    it('should give no refund for <12 hours notice', () => {
      const scheduledAt = new Date(Date.now() + 6 * 60 * 60 * 1000); // 6 hours from now
      const cancelledAt = new Date();

      const result = calculateRefundEligibility(scheduledAt, cancelledAt);

      expect(result.eligible).toBe(false);
      expect(result.refundPercentage).toBe(0);
    });
  });
});
