import { DateTime } from 'luxon';
import {
  hasOverlap,
  isWithinAvailability,
  validateBooking,
  generateWeeklySlots,
  findAvailableSlots,
  RecurringPattern,
  AvailabilitySlot,
  BookingAttempt,
} from '../scheduler.utils';
import { SessionSlot } from '../timezone.utils';

describe('Scheduler Utils', () => {
  describe('hasOverlap', () => {
    it('should detect overlapping bookings', () => {
      const proposed: BookingAttempt = {
        mentorId: 'mentor-1',
        scheduledAt: '2026-03-15T14:00:00',
        durationMinutes: 60,
        timezone: 'America/New_York',
      };

      const existing: SessionSlot[] = [
        {
          scheduledAt: '2026-03-15T14:30:00',
          durationMinutes: 60,
          timezone: 'America/New_York',
        },
      ];

      const result = hasOverlap(proposed, existing);
      expect(result.overlaps).toBe(true);
      expect(result.conflicts.length).toBe(1);
    });

    it('should not detect overlap for non-overlapping bookings', () => {
      const proposed: BookingAttempt = {
        mentorId: 'mentor-1',
        scheduledAt: '2026-03-15T14:00:00',
        durationMinutes: 60,
        timezone: 'America/New_York',
      };

      const existing: SessionSlot[] = [
        {
          scheduledAt: '2026-03-15T15:00:00',
          durationMinutes: 60,
          timezone: 'America/New_York',
        },
      ];

      const result = hasOverlap(proposed, existing);
      expect(result.overlaps).toBe(false);
      expect(result.conflicts.length).toBe(0);
    });

    it('should handle cross-timezone overlaps', () => {
      const proposed: BookingAttempt = {
        mentorId: 'mentor-1',
        scheduledAt: '2026-03-15T14:00:00',
        durationMinutes: 60,
        timezone: 'America/New_York',
      };

      const existing: SessionSlot[] = [
        {
          scheduledAt: '2026-03-15T19:00:00', // Same UTC time
          durationMinutes: 60,
          timezone: 'Europe/London',
        },
      ];

      const result = hasOverlap(proposed, existing);
      expect(result.overlaps).toBe(true);
    });
  });

  describe('isWithinAvailability', () => {
    it('should confirm booking within availability', () => {
      const booking: BookingAttempt = {
        mentorId: 'mentor-1',
        scheduledAt: '2026-03-15T14:00:00',
        durationMinutes: 60,
        timezone: 'America/New_York',
      };

      const availability: AvailabilitySlot[] = [
        {
          start: '2026-03-15T13:00:00',
          end: '2026-03-15T17:00:00',
          timezone: 'America/New_York',
        },
      ];

      const result = isWithinAvailability(booking, availability);
      expect(result.available).toBe(true);
      expect(result.matchedSlot).toBeDefined();
    });

    it('should reject booking outside availability', () => {
      const booking: BookingAttempt = {
        mentorId: 'mentor-1',
        scheduledAt: '2026-03-15T18:00:00',
        durationMinutes: 60,
        timezone: 'America/New_York',
      };

      const availability: AvailabilitySlot[] = [
        {
          start: '2026-03-15T13:00:00',
          end: '2026-03-15T17:00:00',
          timezone: 'America/New_York',
        },
      ];

      const result = isWithinAvailability(booking, availability);
      expect(result.available).toBe(false);
    });

    it('should reject booking that extends beyond availability', () => {
      const booking: BookingAttempt = {
        mentorId: 'mentor-1',
        scheduledAt: '2026-03-15T16:30:00',
        durationMinutes: 60,
        timezone: 'America/New_York',
      };

      const availability: AvailabilitySlot[] = [
        {
          start: '2026-03-15T13:00:00',
          end: '2026-03-15T17:00:00',
          timezone: 'America/New_York',
        },
      ];

      const result = isWithinAvailability(booking, availability);
      expect(result.available).toBe(false);
    });
  });

  describe('validateBooking', () => {
    const availability: AvailabilitySlot[] = [
      {
        start: '2026-03-20T09:00:00',
        end: '2026-03-20T17:00:00',
        timezone: 'America/New_York',
      },
    ];

    it('should validate correct booking', () => {
      const booking: BookingAttempt = {
        mentorId: 'mentor-1',
        scheduledAt: '2026-03-20T14:00:00',
        durationMinutes: 60,
        timezone: 'America/New_York',
      };

      const result = validateBooking(booking, availability, []);
      expect(result.valid).toBe(true);
    });

    it('should reject booking less than 24h ahead', () => {
      const tomorrow = DateTime.now().plus({ hours: 12 }).toISO();
      
      const booking: BookingAttempt = {
        mentorId: 'mentor-1',
        scheduledAt: tomorrow!,
        durationMinutes: 60,
        timezone: 'UTC',
      };

      const result = validateBooking(booking, [], []);
      expect(result.valid).toBe(false);
      expect(result.message).toContain('24h');
    });

    it('should reject booking more than 90 days ahead', () => {
      const farFuture = DateTime.now().plus({ days: 100 }).toISO();
      
      const booking: BookingAttempt = {
        mentorId: 'mentor-1',
        scheduledAt: farFuture!,
        durationMinutes: 60,
        timezone: 'UTC',
      };

      const result = validateBooking(booking, [], []);
      expect(result.valid).toBe(false);
      expect(result.message).toContain('90 days');
    });

    it('should reject booking in the past', () => {
      const past = DateTime.now().minus({ days: 1 }).toISO();
      
      const booking: BookingAttempt = {
        mentorId: 'mentor-1',
        scheduledAt: past!,
        durationMinutes: 60,
        timezone: 'UTC',
      };

      const result = validateBooking(booking, [], []);
      expect(result.valid).toBe(false);
      expect(result.message).toContain('past');
    });
  });

  describe('generateWeeklySlots', () => {
    it('should generate slots for specified days', () => {
      const pattern: RecurringPattern = {
        days: [1, 3, 5], // Mon, Wed, Fri
        startTime: '09:00',
        endTime: '17:00',
        timezone: 'America/New_York',
      };

      const weekOf = '2026-03-16'; // Monday
      const slots = generateWeeklySlots(pattern, weekOf);

      expect(slots.length).toBe(3);
      slots.forEach((slot) => {
        expect(slot.timezone).toBe('America/New_York');
        expect(slot.start).toBeDefined();
        expect(slot.end).toBeDefined();
      });
    });

    it('should handle different timezones', () => {
      const pattern: RecurringPattern = {
        days: [1, 2],
        startTime: '10:00',
        endTime: '18:00',
        timezone: 'Asia/Tokyo',
      };

      const weekOf = '2026-03-16';
      const slots = generateWeeklySlots(pattern, weekOf);

      expect(slots.length).toBe(2);
      expect(slots[0].timezone).toBe('Asia/Tokyo');
    });
  });

  describe('findAvailableSlots', () => {
    it('should find available slots without conflicts', () => {
      const availability: AvailabilitySlot[] = [
        {
          start: '2026-03-20T09:00:00',
          end: '2026-03-20T17:00:00',
          timezone: 'America/New_York',
        },
      ];

      const existingBookings: SessionSlot[] = [];
      const durationMinutes = 60;
      const startDate = '2026-03-20T00:00:00Z';
      const endDate = '2026-03-21T00:00:00Z';

      const slots = findAvailableSlots(
        availability,
        existingBookings,
        durationMinutes,
        startDate,
        endDate
      );

      expect(slots.length).toBeGreaterThan(0);
    });

    it('should exclude booked slots', () => {
      const availability: AvailabilitySlot[] = [
        {
          start: '2026-03-20T09:00:00',
          end: '2026-03-20T17:00:00',
          timezone: 'America/New_York',
        },
      ];

      const existingBookings: SessionSlot[] = [
        {
          scheduledAt: '2026-03-20T10:00:00',
          durationMinutes: 120,
          timezone: 'America/New_York',
        },
      ];

      const durationMinutes = 60;
      const startDate = '2026-03-20T00:00:00Z';
      const endDate = '2026-03-21T00:00:00Z';

      const slots = findAvailableSlots(
        availability,
        existingBookings,
        durationMinutes,
        startDate,
        endDate
      );

      // Should have slots before and after the booking
      expect(slots.length).toBeGreaterThan(0);
    });
  });
});
