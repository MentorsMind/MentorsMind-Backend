-- =============================================================================
-- Migration: 016_add_reminder_flags.sql
-- Description: Add reminder tracking columns to bookings table for
--              24-hour and 15-minute session reminder scheduler (Issue #100)
-- =============================================================================

DO $$
BEGIN
    -- 24-hour reminder flag
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'bookings' AND column_name = 'reminder_24h_sent'
    ) THEN
        ALTER TABLE bookings ADD COLUMN reminder_24h_sent BOOLEAN NOT NULL DEFAULT FALSE;
    END IF;

    -- 15-minute reminder flag
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'bookings' AND column_name = 'reminder_15m_sent'
    ) THEN
        ALTER TABLE bookings ADD COLUMN reminder_15m_sent BOOLEAN NOT NULL DEFAULT FALSE;
    END IF;
END $$;

-- Indexes to speed up the scheduler query (only scans upcoming confirmed bookings)
CREATE INDEX IF NOT EXISTS idx_bookings_reminder_24h
    ON bookings (scheduled_start)
    WHERE status = 'confirmed' AND reminder_24h_sent = FALSE;

CREATE INDEX IF NOT EXISTS idx_bookings_reminder_15m
    ON bookings (scheduled_start)
    WHERE status = 'confirmed' AND reminder_15m_sent = FALSE;

COMMENT ON COLUMN bookings.reminder_24h_sent IS '24-hour pre-session reminder sent to mentor and mentee';
COMMENT ON COLUMN bookings.reminder_15m_sent IS '15-minute pre-session reminder sent to mentor and mentee';
