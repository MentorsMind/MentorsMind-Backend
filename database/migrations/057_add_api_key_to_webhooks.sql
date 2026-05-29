-- Migration: 057_add_api_key_to_webhooks
-- Adds API key authentication support to the webhooks table

ALTER TABLE webhooks
  ADD COLUMN IF NOT EXISTS api_key_hash       TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS api_key_plain      TEXT,
  ADD COLUMN IF NOT EXISTS api_key_last_used_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS api_key_expires_at   TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS api_key_grace_period_end TIMESTAMP WITH TIME ZONE;

-- Create index for faster API key lookups
CREATE INDEX IF NOT EXISTS idx_webhooks_api_key_hash ON webhooks(api_key_hash) WHERE api_key_hash IS NOT NULL;

-- Log table for webhook auth failures
CREATE TABLE IF NOT EXISTS webhook_auth_failures (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id    UUID REFERENCES webhooks(id) ON DELETE SET NULL,
  ip_address    TEXT,
  user_agent    TEXT,
  error_message TEXT,
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_auth_failures_created_at ON webhook_auth_failures(created_at DESC);
