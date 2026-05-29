-- Migration: 022_create_notifications.sql
-- Description: Extend notifications table with action_url, dismissed_at, expires_at
--              and register new notification types

-- Add columns if they don't already exist
ALTER TABLE notifications
    ADD COLUMN IF NOT EXISTS action_url VARCHAR(500),
    ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE
        DEFAULT (NOW() + INTERVAL '90 days');

-- Indexes for cleanup job and filtered queries
CREATE INDEX IF NOT EXISTS idx_notifications_expires_at
    ON notifications(expires_at);
CREATE INDEX IF NOT EXISTS idx_notifications_not_dismissed
    ON notifications(user_id, created_at DESC)
    WHERE dismissed_at IS NULL;

-- Add new enum values (idempotent via DO block)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumlabel = 'booking_confirmed'
          AND enumtypid = 'notification_type'::regtype
    ) THEN
        ALTER TYPE notification_type ADD VALUE 'booking_confirmed';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumlabel = 'verification_approved'
          AND enumtypid = 'notification_type'::regtype
    ) THEN
        ALTER TYPE notification_type ADD VALUE 'verification_approved';
    END IF;
END
$$;

COMMENT ON COLUMN notifications.action_url IS 'Deep-link URL for frontend navigation';
COMMENT ON COLUMN notifications.dismissed_at IS 'Soft-delete: when user dismissed the notification';
COMMENT ON COLUMN notifications.expires_at IS 'Hard expiry — auto-cleaned after 90 days';
