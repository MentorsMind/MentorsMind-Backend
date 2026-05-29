-- =============================================================================
-- Migration: 014_create_notifications.sql
-- Description: Create notifications table for in-app notifications
-- =============================================================================

-- Create notification_type ENUM
CREATE TYPE notification_type AS ENUM (
    'session_booked',
    'session_confirmed',
    'session_cancelled',
    'session_reminder',
    'payment_received',
    'payment_failed',
    'review_received',
    'escrow_released',
    'dispute_opened',
    'meeting_confirmed',
    'message_received',
    'system_alert'
);

-- Create notifications table
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type notification_type NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    data JSONB DEFAULT '{}'::jsonb,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for notifications
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_type ON notifications(type);
CREATE INDEX idx_notifications_is_read ON notifications(is_read);
CREATE INDEX idx_notifications_created_at ON notifications(created_at);
CREATE INDEX idx_notifications_user_unread ON notifications(user_id, is_read) WHERE is_read = FALSE;
CREATE INDEX idx_notifications_user_created ON notifications(user_id, created_at DESC);

-- Add comments
COMMENT ON TABLE notifications IS 'In-app notifications for platform events';
COMMENT ON COLUMN notifications.data IS 'Additional notification metadata (e.g., booking_id, payment_id)';
COMMENT ON COLUMN notifications.is_read IS 'Whether the user has read this notification';
