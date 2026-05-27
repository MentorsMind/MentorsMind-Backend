-- Migration: Create session_transcripts table
-- Supports AWS Transcribe integration with speaker identification,
-- full-text search, and file export (PDF/TXT).

CREATE TYPE transcript_status AS ENUM (
  'pending',
  'processing',
  'completed',
  'failed'
);

CREATE TABLE IF NOT EXISTS session_transcripts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id          UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  status              transcript_status NOT NULL DEFAULT 'pending',

  -- AWS Transcribe job tracking
  transcribe_job_name VARCHAR(255),
  media_s3_key        TEXT,                  -- S3 key of the source audio/video
  transcript_s3_key   TEXT,                  -- S3 key of the raw JSON output

  -- Processed content
  full_text           TEXT,                  -- Plain-text transcript (searchable)
  speakers            JSONB DEFAULT '[]',    -- Array of { speaker, start_time, end_time, text }
  word_count          INTEGER,

  -- Export files (stored in S3)
  pdf_s3_key          TEXT,
  txt_s3_key          TEXT,

  error_message       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookup by booking
CREATE INDEX idx_session_transcripts_booking_id ON session_transcripts(booking_id);

-- Index for status-based polling (worker picks up pending jobs)
CREATE INDEX idx_session_transcripts_status ON session_transcripts(status);

-- Full-text search index on transcript content
CREATE INDEX idx_session_transcripts_fts
  ON session_transcripts
  USING GIN (to_tsvector('english', COALESCE(full_text, '')));

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_session_transcripts_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_session_transcripts_updated_at
  BEFORE UPDATE ON session_transcripts
  FOR EACH ROW EXECUTE FUNCTION update_session_transcripts_updated_at();
