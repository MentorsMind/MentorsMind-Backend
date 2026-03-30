-- Migration 039: Add calendar integration fields
-- Adds iCal token and Google Calendar OAuth columns to users,
-- and Google Calendar event ID columns to bookings.

-- ── users ──────────────────────────────────────────────────────────────────

ALTER TABLE users
ADD COLUMN IF NOT EXISTS ical_token TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS google_calendar_connected BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS google_calendar_access_token TEXT,
ADD COLUMN IF NOT EXISTS google_calendar_refresh_token TEXT,
ADD COLUMN IF NOT EXISTS google_calendar_token_expiry TIMESTAMPTZ;

-- Fast lookup by iCal token (public feed endpoint)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_ical_token ON users (ical_token)
WHERE
    ical_token IS NOT NULL;

-- ── bookings ───────────────────────────────────────────────────────────────

ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS google_event_id_mentor TEXT,
ADD COLUMN IF NOT EXISTS google_event_id_learner TEXT;

-- Index to support cleanup / lookup by event ID if needed
CREATE INDEX IF NOT EXISTS idx_bookings_google_event_ids ON bookings (
    google_event_id_mentor,
    google_event_id_learner
)
WHERE
    google_event_id_mentor IS NOT NULL
    OR google_event_id_learner IS NOT NULL;