import { DateTime, Interval } from 'luxon';
import {
  localToUTC,
  SessionSlot,
  isValidIANATimezone,
} from './timezone.utils';
import { logger } from './logger.utils';

/**
 * Scheduling Utilities - Availability overlap detection & recurring patterns
 * All times converted to UTC for overlap checking (handles DST automatically)
 */

export type AvailabilitySlot = {
  start: string; // Local ISO datetime
  end: string; // Local ISO datetime
  timezone: string;
  recurring?: {
    days: number[]; // 0=Sunday, 1=Monday, ..., 6=Saturday
    until?: string; // UTC ISO end date
  };
};

export type BookingAttempt = {
  mentorId: string;
  scheduledAt: string; // Local ISO
  durationMinutes: number;
  timezone: string; // Learner's timezone
};

/**
 * Check if proposed booking overlaps existing bookings
 * @param proposed - New booking attempt
 * @param existingBookings - Existing confirmed bookings
 * @returns true if overlap found
 */
export const hasOverlap = (
  proposed: BookingAttempt,
  existingBookings: SessionSlot[]
): { overlaps: boolean; conflicts: SessionSlot[] } => {
  const proposedStartUTC = localToUTC(proposed.scheduledAt, proposed.timezone);
  const proposedEndUTC = proposedStartUTC.plus({
    minutes: proposed.durationMinutes,
  });
  const proposedInterval = Interval.fromDateTimes(
    proposedStartUTC,
    proposedEndUTC
  );

  const conflicts: SessionSlot[] = [];

  for (const booking of existingBookings) {
    if (!isValidIANATimezone(booking.timezone)) continue;

    const bookingStartUTC = localToUTC(booking.scheduledAt, booking.timezone);
    const bookingEndUTC = bookingStartUTC.plus({
      minutes: booking.durationMinutes,
    });
    const bookingInterval = Interval.fromDateTimes(
      bookingStartUTC,
      bookingEndUTC
    );

    if (proposedInterval.overlaps(bookingInterval)) {
      conflicts.push(booking);
    }
  }

  return { overlaps: conflicts.length > 0, conflicts };
};

/**
 * Check if booking falls within mentor's availability windows
 */
export const isWithinAvailability = (
  booking: BookingAttempt,
  availabilitySlots: AvailabilitySlot[]
): { available: boolean; matchedSlot?: AvailabilitySlot } => {
  const bookingStartUTC = localToUTC(booking.scheduledAt, booking.timezone);
  const bookingEndUTC = bookingStartUTC.plus({
    minutes: booking.durationMinutes,
  });

  for (const slot of availabilitySlots) {
    const slotStartUTC = localToUTC(slot.start, slot.timezone);
    const slotEndUTC = localToUTC(slot.end, slot.timezone);

    // Booking must be completely within availability slot
    if (
      bookingStartUTC >= slotStartUTC &&
      bookingEndUTC <= slotEndUTC
    ) {
      return { available: true, matchedSlot: slot };
    }
  }

  return { available: false };
};

/**
 * Generate recurring availability slots for a week
 * @param recurringPattern - e.g., { days: [1,2,3], startTime: '09:00', endTime: '17:00', timezone: 'America/New_York' }
 * @param weekOf - Reference date for week start (Monday)
 */
export interface RecurringPattern {
  days: number[]; // 0=Sun...6=Sat
  startTime: string; // '09:00' (local)
  endTime: string; // '17:00' (local)
  timezone: string;
}

export const generateWeeklySlots = (
  pattern: RecurringPattern,
  weekOf: string // ISO date, Monday of week
): AvailabilitySlot[] => {
  const weekStart = DateTime.fromISO(weekOf, { zone: 'utc' }).startOf('week');
  const slots: AvailabilitySlot[] = [];

  for (const day of pattern.days) {
    const [startHour, startMinute] = pattern.startTime.split(':').map(Number);
    const [endHour, endMinute] = pattern.endTime.split(':').map(Number);

    const dayStartLocal = weekStart
      .plus({ days: day })
      .setZone(pattern.timezone)
      .set({
        hour: startHour,
        minute: startMinute,
        second: 0,
        millisecond: 0,
      });

    const dayEndLocal = weekStart
      .plus({ days: day })
      .setZone(pattern.timezone)
      .set({
        hour: endHour,
        minute: endMinute,
        second: 0,
        millisecond: 0,
      });

    slots.push({
      start: dayStartLocal.toISO()!,
      end: dayEndLocal.toISO()!,
      timezone: pattern.timezone,
    });
  }

  return slots;
};

/**
 * Validate booking request with mentor availability and existing bookings
 */
export const validateBooking = (
  booking: BookingAttempt,
  mentorAvailability: AvailabilitySlot[],
  existingBookings: SessionSlot[]
): { valid: boolean; message: string; conflicts?: SessionSlot[] } => {
  // Check if within availability windows
  const availabilityCheck = isWithinAvailability(booking, mentorAvailability);
  if (!availabilityCheck.available) {
    return {
      valid: false,
      message: 'Proposed time is outside mentor availability windows',
    };
  }

  // Check for overlaps with existing bookings
  const overlapCheck = hasOverlap(booking, existingBookings);
  if (overlapCheck.overlaps) {
    return {
      valid: false,
      message: 'Proposed time overlaps with existing sessions',
      conflicts: overlapCheck.conflicts,
    };
  }

  // Additional checks: min 24h notice, max 90 days ahead
  const proposedStart = localToUTC(booking.scheduledAt, booking.timezone);
  const nowUTC = DateTime.now().toUTC();

  if (proposedStart.diff(nowUTC, 'hours').hours < 24) {
    return { valid: false, message: 'Bookings require 24h advance notice' };
  }

  if (proposedStart.diff(nowUTC, 'days').days > 90) {
    return {
      valid: false,
      message: 'Bookings cannot be scheduled more than 90 days ahead',
    };
  }

  if (proposedStart < nowUTC) {
    return { valid: false, message: 'Cannot book sessions in the past' };
  }

  return { valid: true, message: 'Booking valid' };
};

/**
 * Find available slots within a time range
 * Analyzes gaps in mentor's schedule
 */
export const findAvailableSlots = (
  mentorAvailability: AvailabilitySlot[],
  existingBookings: SessionSlot[],
  durationMinutes: number,
  startDate: string, // UTC ISO
  endDate: string // UTC ISO
): AvailabilitySlot[] => {
  const availableSlots: AvailabilitySlot[] = [];
  const startUTC = DateTime.fromISO(startDate, { zone: 'utc' });
  const endUTC = DateTime.fromISO(endDate, { zone: 'utc' });

  for (const slot of mentorAvailability) {
    const slotStartUTC = localToUTC(slot.start, slot.timezone);
    const slotEndUTC = localToUTC(slot.end, slot.timezone);

    // Skip slots outside date range
    if (slotEndUTC < startUTC || slotStartUTC > endUTC) continue;

    // Check if slot has enough duration
    const slotDuration = slotEndUTC.diff(slotStartUTC, 'minutes').minutes;
    if (slotDuration < durationMinutes) continue;

    // Check for conflicts with existing bookings
    let currentStart = slotStartUTC;
    const slotInterval = Interval.fromDateTimes(slotStartUTC, slotEndUTC);

    for (const booking of existingBookings) {
      const bookingStartUTC = localToUTC(
        booking.scheduledAt,
        booking.timezone
      );
      const bookingEndUTC = bookingStartUTC.plus({
        minutes: booking.durationMinutes,
      });
      const bookingInterval = Interval.fromDateTimes(
        bookingStartUTC,
        bookingEndUTC
      );

      if (slotInterval.overlaps(bookingInterval)) {
        // Add free slot before booking if large enough
        if (bookingStartUTC.diff(currentStart, 'minutes').minutes >= durationMinutes) {
          availableSlots.push({
            start: currentStart.setZone(slot.timezone).toISO()!,
            end: bookingStartUTC.setZone(slot.timezone).toISO()!,
            timezone: slot.timezone,
          });
        }
        currentStart = bookingEndUTC;
      }
    }

    // Add remaining slot if large enough
    if (slotEndUTC.diff(currentStart, 'minutes').minutes >= durationMinutes) {
      availableSlots.push({
        start: currentStart.setZone(slot.timezone).toISO()!,
        end: slotEndUTC.setZone(slot.timezone).toISO()!,
        timezone: slot.timezone,
      });
    }
  }

  return availableSlots;
};

/**
 * Log scheduling conflict for debugging
 */
export const logSchedulingConflict = (
  booking: BookingAttempt,
  conflicts: SessionSlot[]
) => {
  logger.warn('Booking conflict detected', {
    mentorId: booking.mentorId,
    proposed: booking.scheduledAt,
    timezone: booking.timezone,
    conflictCount: conflicts.length,
    conflicts: conflicts.map((c) => ({
      start: c.scheduledAt,
      duration: c.durationMinutes,
      tz: c.timezone,
    })),
  });
};
