-- =============================================================================
-- Migration: 166_create_calendar_sync_events_table.sql
-- Description: Create calendar_sync_events table to track synced calendar events
-- and prevent duplicate entries during sync
-- =============================================================================

-- Create calendar_sync_events table to track external calendar events
-- that have been synced for each user. This enables idempotent sync operations.
CREATE TABLE IF NOT EXISTS calendar_sync_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  external_id VARCHAR(255) NOT NULL,
  provider VARCHAR(20) NOT NULL DEFAULT 'google',
  event_title TEXT,
  event_description TEXT,
  event_start TIMESTAMP WITH TIME ZONE,
  event_end TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (user_id, external_id)
);

-- Create index for fast lookup by user_id
CREATE INDEX IF NOT EXISTS idx_calendar_sync_events_user ON calendar_sync_events(user_id);

-- Create composite index for the unique constraint lookup
CREATE INDEX IF NOT EXISTS idx_calendar_sync_events_user_external ON calendar_sync_events(user_id, external_id);

-- Comment to document the table purpose
COMMENT ON TABLE calendar_sync_events IS
  'Tracks externally synced calendar events per user to prevent duplicates';

COMMENT ON COLUMN calendar_sync_events.external_id IS
  'The external event ID from the calendar provider (e.g., Google Calendar event ID)';
COMMENT ON COLUMN calendar_sync_events.provider IS
  'The calendar provider (google, outlook, apple)';