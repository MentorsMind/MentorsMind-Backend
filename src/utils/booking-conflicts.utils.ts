/**
 * Booking Conflict Detection Utilities
 * Handles time slot conflict detection and validation for booking sessions.
 */

export interface TimeSlot {
  start: Date;
  end: Date;
}

export interface BookingConflict {
  hasConflict: boolean;
  conflictingBookingId?: string;
  message?: string;
}

/**
 * Check if two time slots overlap
 */
export const doTimeSlotsOverlap = (slot1: TimeSlot, slot2: TimeSlot): boolean => {
  return (
    (slot1.start <= slot2.start && slot1.end > slot2.start) ||
    (slot1.start < slot2.end && slot1.end >= slot2.end) ||
    (slot1.start >= slot2.start && slot1.end <= slot2.end)
  );
};

/**
 * Calculate end time from start time and duration
 */
export const calculateEndTime = (startTime: Date, durationMinutes: number): Date => {
  return new Date(startTime.getTime() + durationMinutes * 60000);
};

/**
 * Validate that a booking time is in the future
 */
export const isBookingInFuture = (scheduledAt: Date, bufferMinutes: number = 30): boolean => {
  const now = new Date();
  const minBookingTime = new Date(now.getTime() + bufferMinutes * 60000);
  return scheduledAt >= minBookingTime;
};

/**
 * Validate booking time is within business hours (optional constraint)
 */
export const isWithinBusinessHours = (scheduledAt: Date): boolean => {
  const hour = scheduledAt.getHours();
  const day = scheduledAt.getDay();
  
  // Weekend check (0 = Sunday, 6 = Saturday)
  if (day === 0 || day === 6) {
    return false;
  }
  
  // Business hours: 8 AM to 8 PM
  return hour >= 8 && hour < 20;
};

/**
 * Format conflict message
 */
export const formatConflictMessage = (existingBooking: {
  scheduled_at: Date;
  duration_minutes: number;
}): string => {
  const start = new Date(existingBooking.scheduled_at);
  const end = calculateEndTime(start, existingBooking.duration_minutes);
  
  return `Mentor has an existing booking from ${start.toISOString()} to ${end.toISOString()}`;
};

/**
 * Validate booking duration is reasonable
 */
export const isValidDuration = (durationMinutes: number): boolean => {
  return durationMinutes >= 15 && durationMinutes <= 240 && durationMinutes % 15 === 0;
};

/**
 * Calculate refund eligibility based on cancellation time
 */
export const calculateRefundEligibility = (scheduledAt: Date, cancelledAt: Date = new Date()): {
  eligible: boolean;
  refundPercentage: number;
  reason: string;
} => {
  const hoursUntilSession = (scheduledAt.getTime() - cancelledAt.getTime()) / (1000 * 60 * 60);
  
  if (hoursUntilSession >= 24) {
    return {
      eligible: true,
      refundPercentage: 100,
      reason: 'Cancelled more than 24 hours in advance',
    };
  } else if (hoursUntilSession >= 12) {
    return {
      eligible: true,
      refundPercentage: 50,
      reason: 'Cancelled 12-24 hours in advance',
    };
  } else {
    return {
      eligible: false,
      refundPercentage: 0,
      reason: 'Cancelled less than 12 hours in advance',
    };
  }
};
