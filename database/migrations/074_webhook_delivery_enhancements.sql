-- Migration: 074_webhook_delivery_enhancements
-- Adds dead letter queue, event filtering, delivery analytics for webhooks

-- Add delivery analytics columns to webhooks
ALTER TABLE webhooks
ADD COLUMN IF NOT EXISTS resource_types TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS filter_statuses TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS api_key TEXT,
ADD COLUMN IF NOT EXISTS api_key_plain TEXT,
ADD COLUMN IF NOT EXISTS api_key_grace_period_end TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS total_deliveries INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS successful_deliveries INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS failed_deliveries INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS avg_response_time_ms INTEGER,
ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS last_failure_at TIMESTAMP WITH TIME ZONE;

-- Dead letter queue for permanently failed deliveries
CREATE TABLE IF NOT EXISTS webhook_dead_letter_queue (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id        UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  delivery_id       UUID REFERENCES webhook_deliveries(id) ON DELETE SET NULL,
  event_type        TEXT NOT NULL,
  payload           JSONB NOT NULL,
  failure_reason    TEXT NOT NULL,
  attempt_count     INTEGER NOT NULL,
  last_attempt_at   TIMESTAMP WITH TIME ZONE NOT NULL,
  dlq_inserted_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  reprocessed       BOOLEAN NOT NULL DEFAULT false,
  reprocessed_at    TIMESTAMP WITH TIME ZONE,
  created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Webhook delivery stats materialized view
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_webhook_delivery_stats AS
SELECT
  w.id AS webhook_id,
  w.user_id,
  w.url,
  w.event_types,
  w.is_active,
  COUNT(wd.id) AS total_deliveries,
  COUNT(*) FILTER (WHERE wd.status = 'success') AS successful_deliveries,
  COUNT(*) FILTER (WHERE wd.status = 'failed') AS failed_deliveries,
  COUNT(*) FILTER (WHERE wd.status = 'retrying') AS pending_retries,
  COALESCE(AVG(wd.duration_ms) FILTER (WHERE wd.status = 'success'), 0)::INTEGER AS avg_response_time_ms,
  MAX(wd.delivered_at) FILTER (WHERE wd.status = 'success') AS last_success_at,
  MAX(wd.created_at) FILTER (WHERE wd.status = 'failed') AS last_failure_at,
  COUNT(dlq.id) AS dead_letter_count
FROM webhooks w
LEFT JOIN webhook_deliveries wd ON wd.webhook_id = w.id
LEFT JOIN webhook_dead_letter_queue dlq ON dlq.webhook_id = w.id
GROUP BY w.id, w.user_id, w.url, w.event_types, w.is_active;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_webhook_delivery_stats_id ON mv_webhook_delivery_stats(webhook_id);

-- Index for dead letter queue
CREATE INDEX IF NOT EXISTS idx_webhook_dlq_webhook_id ON webhook_dead_letter_queue(webhook_id);
CREATE INDEX IF NOT EXISTS idx_webhook_dlq_reprocessed ON webhook_dead_letter_queue(reprocessed) WHERE reprocessed = false;
