-- =============================================================================
-- Migration: 088_add_1h_reminders_to_bookings.sql
-- Description: Add 1-hour session reminder tracking columns to bookings table
-- =============================================================================

DO $$
BEGIN
    -- 1-hour reminder mentee flag
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'bookings' AND column_name = 'reminder_1h_sent_mentee'
    ) THEN
        ALTER TABLE bookings ADD COLUMN reminder_1h_sent_mentee BOOLEAN NOT NULL DEFAULT FALSE;
    END IF;

    -- 1-hour reminder mentor flag
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'bookings' AND column_name = 'reminder_1h_sent_mentor'
    ) THEN
        ALTER TABLE bookings ADD COLUMN reminder_1h_sent_mentor BOOLEAN NOT NULL DEFAULT FALSE;
    END IF;
END $$;

-- Indexes to speed up the scheduler query
CREATE INDEX IF NOT EXISTS idx_bookings_reminder_1h_mentee
    ON bookings (scheduled_start)
    WHERE status = 'confirmed' AND reminder_1h_sent_mentee = FALSE;

CREATE INDEX IF NOT EXISTS idx_bookings_reminder_1h_mentor
    ON bookings (scheduled_start)
    WHERE status = 'confirmed' AND reminder_1h_sent_mentor = FALSE;

COMMENT ON COLUMN bookings.reminder_1h_sent_mentee IS '1-hour pre-session reminder sent to mentee';
COMMENT ON COLUMN bookings.reminder_1h_sent_mentor IS '1-hour pre-session reminder sent to mentor';
