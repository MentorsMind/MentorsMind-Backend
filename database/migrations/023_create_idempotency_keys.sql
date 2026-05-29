-- Migration 023: idempotency_keys table
-- Stores processed request responses to prevent duplicate mutations.

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key          TEXT        NOT NULL,
  user_id      UUID        NOT NULL,
  endpoint     TEXT        NOT NULL,
  response_body JSONB      NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (key, user_id)
);

-- Auto-expire rows older than 24 hours via a scheduled cleanup or pg_cron.
-- Index for fast lookup and cleanup of expired rows.
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_created_at ON idempotency_keys (created_at);
