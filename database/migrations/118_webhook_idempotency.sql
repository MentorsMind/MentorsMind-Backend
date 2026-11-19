-- =============================================================================
-- Migration: 118_webhook_idempotency.sql
-- Description: Inbound webhook event inbox with dedup + replay support.
--              Processed event IDs are also tracked in Redis (24h TTL); this
--              table is the durable record used for admin replay and audit.
-- =============================================================================

CREATE TABLE IF NOT EXISTS webhook_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        TEXT NOT NULL,               -- 'sendgrid' | 'mailgun' | 'stripe' | 'stellar'
  event_id        TEXT NOT NULL,               -- natural dedup key (sg_message_id / message-id / tx hash)
  event_type      TEXT,                        -- mapped delivery status / event name
  payload         JSONB NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'received',  -- received | processed | replayed
  processed_at    TIMESTAMP WITH TIME ZONE,
  replayed_at     TIMESTAMP WITH TIME ZONE,
  replay_count    INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (provider, event_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_provider_created
  ON webhook_events (provider, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_webhook_events_status
  ON webhook_events (status);
