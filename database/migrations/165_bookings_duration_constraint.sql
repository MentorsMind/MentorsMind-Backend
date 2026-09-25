-- =============================================================================
-- Migration: 165_bookings_duration_constraint.sql
-- Description: Add constraint to enforce valid duration_minutes values
-- =============================================================================
-- This migration adds database-level constraints to ensure duration_minutes
-- in the bookings table is always a valid value (15, 30, 45, 60, 75, etc.)
-- Valid values are multiples of 15 between 15 and 480 minutes (15 mins to 8 hours)
--
-- This prevents data corruption from direct database writes or migration errors
-- that could store invalid session durations and cause booking calculations to fail.
-- =============================================================================

-- Pre-check: Identify any existing bookings with invalid duration_minutes
-- If any rows would violate the constraint, this query will help identify them
-- Run this manually to review before migration if needed:
-- SELECT id, mentee_id, mentor_id, duration_minutes, scheduled_start, scheduled_end
-- FROM bookings
-- WHERE duration_minutes < 15
--    OR duration_minutes > 480
--    OR duration_minutes % 15 != 0;

-- Add the constraint to enforce valid duration_minutes
-- The constraint checks:
-- 1. duration_minutes >= 15 (minimum 15 minutes)
-- 2. duration_minutes <= 480 (maximum 480 minutes / 8 hours)
-- 3. duration_minutes % 15 = 0 (must be a multiple of 15)
ALTER TABLE bookings
ADD CONSTRAINT chk_duration_minutes_valid CHECK (
  duration_minutes >= 15
  AND duration_minutes <= 480
  AND duration_minutes % 15 = 0
);

-- Document the constraint
COMMENT ON CONSTRAINT chk_duration_minutes_valid ON bookings IS
  'Ensures duration_minutes is a valid booking duration (multiple of 15, between 15-480 minutes)';

-- Create an index on duration_minutes for performance when filtering by duration
CREATE INDEX IF NOT EXISTS idx_bookings_duration_minutes ON bookings(duration_minutes);

-- Log successful migration
-- This constraint ensures data integrity at the database level
-- Any attempt to insert or update with invalid duration_minutes will be rejected
