/**
 * Booking Conflict Detection Utilities
 * Handles time slot conflict detection and validation for booking sessions.
 */

import { logger } from "./logger.utils";
import { createError } from "../middleware/errorHandler";
import { ErrorCode } from "../errors/error-codes";

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

export interface AdvisoryLockClient {
  query: (text: string, params?: any[]) => Promise<any>;
}

export interface AdvisoryLockOptions {
  initialDelayMs?: number;
  maxDelayMs?: number;
  jitterMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
}

/**
 * Pauses execution for the specified duration in milliseconds.
 */
export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * Acquires a PostgreSQL transaction-level advisory lock using exponential backoff with jitter.
 *
 * Backoff configuration:
 * - Initial delay: 10ms (default)
 * - Delay multiplier: 2x per failed attempt
 * - Maximum delay: 500ms (default)
 * - Jitter: ±10ms (default)
 * - Maximum total wait: 5000ms (default)
 *
 * Total attempts are logged at debug level when the lock is finally acquired.
 *
 * @param client Database client capable of executing queries
 * @param key Unique lock key string (will be hashed with hashtext)
 * @param timeoutMs Maximum total wait time in milliseconds (defaults to 5000ms / 5s)
 * @param options Optional configuration overrides
 * @returns boolean true if acquired, false if timeout reached
 */
export async function waitForAdvisoryLock(
  client: AdvisoryLockClient,
  key: string,
  timeoutMs: number = 5000,
  options?: AdvisoryLockOptions,
): Promise<boolean> {
  const initialDelay = options?.initialDelayMs ?? 10;
  const maxDelay = options?.maxDelayMs ?? 500;
  const jitterRange = options?.jitterMs ?? 10;
  const sleepFunc = options?.sleepFn ?? sleep;

  const startTime = Date.now();
  let delay = initialDelay;
  let attempts = 0;

  while (Date.now() - startTime < timeoutMs) {
    attempts++;
    const { rows } = await client.query(
      "SELECT pg_try_advisory_xact_lock(hashtext($1)) as locked",
      [key],
    );

    if (rows && rows[0]?.locked) {
      logger.debug(`Advisory lock acquired after ${attempts} attempts`, {
        key,
        attempts,
        elapsedMs: Date.now() - startTime,
      });
      return true;
    }

    const elapsed = Date.now() - startTime;
    if (elapsed >= timeoutMs) {
      break;
    }

    // Jitter: ±10ms per acceptance criteria
    const jitter = (Math.random() * 2 - 1) * jitterRange;
    const remaining = timeoutMs - elapsed;
    // Cap sleep duration so total wait does not exceed timeoutMs
    const sleepDuration = Math.max(0, Math.min(delay + jitter, remaining));

    await sleepFunc(sleepDuration);
    delay = Math.min(delay * 2, maxDelay);
  }

  logger.warn(`Failed to acquire advisory lock within ${timeoutMs}ms`, {
    key,
    attempts,
    elapsedMs: Date.now() - startTime,
  });

  return false;
}

/**
 * Helper to acquire an advisory lock or execute an async callback while holding the advisory lock.
 * Throws a 409 Conflict error if the lock cannot be acquired within the timeout.
 */
export async function withAdvisoryLock<T>(
  client: AdvisoryLockClient,
  key: string,
  callback: () => Promise<T>,
  timeoutMs?: number,
  options?: AdvisoryLockOptions,
): Promise<T>;
export async function withAdvisoryLock(
  client: AdvisoryLockClient,
  key: string,
  timeoutMs?: number,
): Promise<boolean>;
export async function withAdvisoryLock<T>(
  client: AdvisoryLockClient,
  key: string,
  callbackOrTimeout?: (() => Promise<T>) | number,
  timeoutMs: number = 5000,
  options?: AdvisoryLockOptions,
): Promise<T | boolean> {
  const timeout = typeof callbackOrTimeout === "number" ? callbackOrTimeout : timeoutMs;
  const lockFn =
    typeof exports !== "undefined" && exports.waitForAdvisoryLock
      ? exports.waitForAdvisoryLock
      : waitForAdvisoryLock;
  const acquired = await lockFn(client, key, timeout, options);

  if (!acquired) {
    throw createError(ErrorCode.BOOKING_CONFLICT, 409);
  }

  if (typeof callbackOrTimeout === "function") {
    return await callbackOrTimeout();
  }

  return true;
}
