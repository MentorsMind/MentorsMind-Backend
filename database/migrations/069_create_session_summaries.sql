-- Migration: Create session_summaries table
-- Supports AI-powered session summaries with key topics, action items,
-- learning outcomes, and personalized recommendations.

CREATE TYPE summary_status AS ENUM (
  'pending',
  'processing',
  'completed',
  'failed'
);

CREATE TABLE IF NOT EXISTS session_summaries (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id          UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  session_id          UUID REFERENCES sessions(id) ON DELETE SET NULL,
  
  -- Summary status and metadata
  status              summary_status NOT NULL DEFAULT 'pending',
  ai_provider         VARCHAR(50),                    -- 'openai' | 'anthropic'
  ai_model            VARCHAR(100),
  ai_confidence       DECIMAL(3,2),                  -- 0.00 to 1.00
  
  -- AI-generated content
  key_topics          JSONB DEFAULT '[]',            -- Array of topic strings
  action_items        JSONB DEFAULT '[]',            -- Array of {description, assigned_to, due_date, completed}
  learning_outcomes   JSONB DEFAULT '[]',            -- Array of outcome strings
  next_steps          JSONB DEFAULT '[]',            -- Array of step strings
  recommendations     JSONB DEFAULT '[]',            -- Array of personalized learning recommendations
  
  -- Source data
  transcript_id       UUID REFERENCES session_transcripts(id) ON DELETE SET NULL,
  source_text         TEXT,                          -- Combined transcript + notes
  word_count          INTEGER,
  
  -- Processing metadata
  processing_time_ms  INTEGER,
  error_message       TEXT,
  tokens_used         INTEGER,
  
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookup by booking
CREATE INDEX idx_session_summaries_booking_id ON session_summaries(booking_id);

-- Index for session lookup
CREATE INDEX idx_session_summaries_session_id ON session_summaries(session_id) WHERE session_id IS NOT NULL;

-- Index for status-based queries
CREATE INDEX idx_session_summaries_status ON session_summaries(status);

-- Index for transcript lookup
CREATE INDEX idx_session_summaries_transcript_id ON session_summaries(transcript_id) WHERE transcript_id IS NOT NULL;

-- Full-text search on summary content
CREATE INDEX idx_session_summaries_fts
  ON session_summaries
  USING GIN (to_tsvector('english', COALESCE(source_text, '')));

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_session_summaries_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_session_summaries_updated_at
  BEFORE UPDATE ON session_summaries
  FOR EACH ROW EXECUTE FUNCTION update_session_summaries_updated_at();
