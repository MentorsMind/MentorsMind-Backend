-- Migration: Add notification_preferences to users table
-- Description: Let users control which notification channels (email, push, in-app) they receive for each event type.

ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_preferences JSONB DEFAULT '{
  "booking_confirmed": {"email": true, "push": true, "in_app": true},
  "payment_processed": {"email": true, "push": true, "in_app": true},
  "session_reminder": {"email": true, "push": true, "in_app": true},
  "dispute_created": {"email": true, "push": true, "in_app": true},
  "system_alert": {"email": true, "push": true, "in_app": true},
  "meeting_confirmed": {"email": true, "push": true, "in_app": true},
  "message_received": {"email": true, "push": true, "in_app": true},
  "session_cancelled": {"email": true, "push": true, "in_app": true}
}'::jsonb;
