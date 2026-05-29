-- Migration: 038_create_webhook_deliveries
-- Tracks every outbound webhook delivery attempt

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id      UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL,
  payload         JSONB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'success', 'failed', 'retrying')),
  attempt_number  INTEGER NOT NULL DEFAULT 1,
  next_retry_at   TIMESTAMP WITH TIME ZONE,
  response_status INTEGER,                              -- HTTP status code from target
  response_body   TEXT,                                 -- first 4 KB of response body
  error_message   TEXT,
  duration_ms     INTEGER,                              -- round-trip time in milliseconds
  delivered_at    TIMESTAMP WITH TIME ZONE,             -- set on first success
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook_id   ON webhook_deliveries(webhook_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status       ON webhook_deliveries(status);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_next_retry   ON webhook_deliveries(next_retry_at)
  WHERE status = 'retrying';
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_created_at   ON webhook_deliveries(created_at DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_webhook_deliveries_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_webhook_deliveries_updated_at ON webhook_deliveries;
CREATE TRIGGER trg_webhook_deliveries_updated_at
  BEFORE UPDATE ON webhook_deliveries
  FOR EACH ROW EXECUTE FUNCTION update_webhook_deliveries_updated_at();
