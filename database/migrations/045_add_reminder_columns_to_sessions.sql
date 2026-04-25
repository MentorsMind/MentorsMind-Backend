-- =============================================================================
-- Migration: 045_add_reminder_columns_to_sessions.sql
-- Description: Add reminder tracking columns to sessions table for
--              24-hour and 1-hour session reminder scheduler
-- =============================================================================

DO $$
BEGIN
    -- 24-hour reminder timestamp
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'sessions' AND column_name = 'reminded_24h'
    ) THEN
        ALTER TABLE sessions ADD COLUMN reminded_24h TIMESTAMP WITH TIME ZONE;
    END IF;

    -- 1-hour reminder timestamp
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'sessions' AND column_name = 'reminded_1h'
    ) THEN
        ALTER TABLE sessions ADD COLUMN reminded_1h TIMESTAMP WITH TIME ZONE;
    END IF;
END $$;

-- Index to speed up the scheduler query (only scans upcoming confirmed sessions)
CREATE INDEX IF NOT EXISTS idx_sessions_reminders
    ON sessions (reminded_24h, reminded_1h)
    WHERE status = 'confirmed';

COMMENT ON COLUMN sessions.reminded_24h IS 'Timestamp when the 24-hour pre-session reminder was sent';
COMMENT ON COLUMN sessions.reminded_1h IS 'Timestamp when the 1-hour pre-session reminder was sent';

