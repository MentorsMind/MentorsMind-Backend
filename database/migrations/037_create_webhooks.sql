-- Migration: 037_create_webhooks
-- Creates the webhooks table for outbound webhook subscriptions

CREATE TABLE IF NOT EXISTS webhooks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url           TEXT NOT NULL,
  secret        TEXT NOT NULL,                          -- HMAC-SHA256 signing secret (stored hashed)
  secret_plain  TEXT NOT NULL,                          -- Plain secret shown once at creation
  event_types   TEXT[] NOT NULL DEFAULT '{}',           -- e.g. ['booking.created', 'payment.confirmed']
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  failure_count INTEGER NOT NULL DEFAULT 0,             -- consecutive failure counter
  disabled_at   TIMESTAMP WITH TIME ZONE,               -- set when auto-disabled after 10 failures
  description   TEXT,
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhooks_user_id    ON webhooks(user_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_is_active  ON webhooks(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_webhooks_event_types ON webhooks USING GIN(event_types);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_webhooks_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_webhooks_updated_at ON webhooks;
CREATE TRIGGER trg_webhooks_updated_at
  BEFORE UPDATE ON webhooks
  FOR EACH ROW EXECUTE FUNCTION update_webhooks_updated_at();
