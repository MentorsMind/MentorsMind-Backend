-- Migration 057: Offline Action Queue & Sync State
-- Supports mobile offline mode: queued actions, sync state, conflict tracking

-- ─── Offline Action Queue ────────────────────────────────────────────────────
-- Stores actions captured while the mobile client was offline.
-- The server processes them in order when the client reconnects.
CREATE TABLE IF NOT EXISTS offline_action_queue (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Client-assigned idempotency key (UUID) — prevents duplicate processing
  client_key       VARCHAR(36) NOT NULL,

  -- Action type: 'booking:create', 'booking:cancel', 'booking:reschedule',
  --              'review:create', 'note:create', 'note:update', 'goal:update',
  --              'profile:update', 'message:send'
  action_type      VARCHAR(64) NOT NULL,

  -- Full action payload (JSON)
  payload          JSONB NOT NULL DEFAULT '{}',

  -- Processing state
  status           VARCHAR(16) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'conflict')),

  -- Ordering: client-side timestamp when the action was captured offline
  client_timestamp TIMESTAMPTZ NOT NULL,

  -- Server processing results
  result           JSONB,
  error_message    TEXT,
  conflict_data    JSONB,   -- populated when status = 'conflict'

  -- Retry tracking
  attempt_count    INT NOT NULL DEFAULT 0,
  max_attempts     INT NOT NULL DEFAULT 3,

  -- Timestamps
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at     TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint: one action per (user, client_key)
CREATE UNIQUE INDEX IF NOT EXISTS uq_offline_action_user_key
  ON offline_action_queue (user_id, client_key);

-- Fast lookup: pending actions for a user, ordered by client timestamp
CREATE INDEX IF NOT EXISTS idx_offline_action_user_status
  ON offline_action_queue (user_id, status, client_timestamp ASC);

-- Cleanup index: find old completed/failed actions
CREATE INDEX IF NOT EXISTS idx_offline_action_created
  ON offline_action_queue (created_at);

-- ─── Offline Sync State ───────────────────────────────────────────────────────
-- Tracks the last successful sync checkpoint per user per data domain.
-- The mobile client uses these cursors to request only changed data.
CREATE TABLE IF NOT EXISTS offline_sync_state (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Data domain: 'bookings', 'profile', 'notifications', 'goals', 'messages'
  domain         VARCHAR(32) NOT NULL,

  -- Server-side cursor: ISO timestamp of the last record included in the snapshot
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- ETag / version hash of the last snapshot (for conditional requests)
  etag           VARCHAR(64),

  -- Number of records in the last snapshot
  record_count   INT NOT NULL DEFAULT 0,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_offline_sync_user_domain UNIQUE (user_id, domain)
);

CREATE INDEX IF NOT EXISTS idx_offline_sync_user
  ON offline_sync_state (user_id);

-- ─── Trigger: updated_at maintenance ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_offline_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_offline_action_updated_at
  BEFORE UPDATE ON offline_action_queue
  FOR EACH ROW EXECUTE FUNCTION update_offline_updated_at();

CREATE TRIGGER trg_offline_sync_updated_at
  BEFORE UPDATE ON offline_sync_state
  FOR EACH ROW EXECUTE FUNCTION update_offline_updated_at();
