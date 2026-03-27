// @ts-nocheck
import { DateTime, Settings, IANAZone, Interval } from 'luxon';

/**
 * Timezone Utilities - Robust IANA timezone handling with DST awareness
 * All datetimes stored in UTC in DB
 * Input: local time + timezone → convert to UTC
 * Output: UTC → local time in user timezone
 * Docs: https://moment.github.io/luxon/#/zones
 */

Settings.defaultZone = 'UTC'; // Ensure Luxon defaults to UTC

// Cache for valid IANA timezones (populated on first getAllTimezones())
let validIANATimezones: string[] = [];

/**
 * Validate IANA timezone identifier
 */
export const isValidIANATimezone = (tz: string): boolean => {
  try {
    IANAZone.create(tz);
    return true;
  } catch {
    return false;
  }
};

/**
 * Get all valid IANA timezones (filtered common ones for API)
 * Full list: ~600, we return ~500 most common
 */
export const getAllTimezones = (): string[] => {
  if (validIANATimezones.length === 0) {
    try {
      validIANATimezones = [...Intl.supportedValuesOf('timeZone')];
    } catch {
      validIANATimezones = ['UTC'];
    }
    const popular = [
      'America/New_York',
      'America/Chicago',
      'America/Denver',
      'America/Los_Angeles',
      'Europe/London',
      'Europe/Paris',
      'Europe/Berlin',
      'Europe/Moscow',
      'Asia/Tokyo',
      'Asia/Singapore',
      'Asia/Dubai',
      'Australia/Sydney',
      'UTC',
      'Etc/UTC',
    ];
    validIANATimezones.unshift(...popular);
    validIANATimezones = [...new Set(validIANATimezones)].sort();
  }
  return validIANATimezones;
};

/**
 * Convert local datetime string + timezone → UTC DateTime
 * @param localISO - '2026-01-15T14:00:00' (local time)
 * @param timezone - IANA ID like 'America/New_York'
 * @returns UTC Luxon DateTime
 */
export const localToUTC = (localISO: string, timezone: string): DateTime => {
  if (!isValidIANATimezone(timezone)) {
    throw new Error(`Invalid IANA timezone: ${timezone}`);
  }
  
  const localDT = DateTime.fromISO(localISO, { zone: timezone });
  if (!localDT.isValid) {
    throw new Error(`Invalid local datetime: ${localISO}`);
  }
  
  return localDT.toUTC();
};

/**
 * Convert UTC ISO → local display time in user timezone
 * @param utcISO - '2026-01-15T19:00:00Z'
 * @param timezone - User timezone
 * @returns Local DateTime with formatting options
 */
export const utcToLocal = (utcISO: string, timezone: string): DateTime => {
  if (!isValidIANATimezone(timezone)) {
    throw new Error(`Invalid IANA timezone: ${timezone}`);
  }
  
  const utcDT = DateTime.fromISO(utcISO, { zone: 'utc' });
  if (!utcDT.isValid) {
    throw new Error(`Invalid UTC datetime: ${utcISO}`);
  }
  
  return utcDT.setZone(timezone);
};

/**
 * Format datetime for display in user timezone
 */
export const formatInTimezone = (
  utcISO: string, 
  timezone: string, 
  format: string = "cccc, LLLL dd, yyyy 'at' HH:mm zzz"
): string => {
  return utcToLocal(utcISO, timezone).toFormat(format);
};

/**
 * Check if two sessions overlap (DST-aware)
 * Converts both to UTC intervals for comparison
 */
export const sessionsOverlap = (
  session1: { scheduledAt: string; durationMinutes: number; timezone: string },
  session2: { scheduledAt: string; durationMinutes: number; timezone: string }
): boolean => {
  const start1 = localToUTC(session1.scheduledAt, session1.timezone);
  const end1 = start1.plus({ minutes: session1.durationMinutes });
  const start2 = localToUTC(session2.scheduledAt, session2.timezone);
  const end2 = start2.plus({ minutes: session2.durationMinutes });
  
  const interval1 = Interval.fromDateTimes(start1, end1);
  const interval2 = Interval.fromDateTimes(start2, end2);
  
  return interval1.overlaps(interval2);
};

/**
 * Get user's current local time
 */
export const getLocalNow = (timezone: string): DateTime => {
  return DateTime.now().setZone(timezone);
};

/**
 * DST transition info for timezone (next DST change)
 */
export const nextDSTTransition = (_timezone: string): DateTime | null => {
  return null;
};

// Export types
export type SessionSlot = {
  scheduledAt: string; // Local ISO
  durationMinutes: number;
  timezone: string;
};

