-- Migration: 060_add_webhook_alert_tracking
-- Add alert tracking for webhook failures after 3 consecutive attempts

-- Add column to track if alert was sent for 3 consecutive failures
ALTER TABLE webhooks
ADD COLUMN IF NOT EXISTS alert_sent_at TIMESTAMP WITH TIME ZONE;

-- Add column to track the last alert type sent
ALTER TABLE webhooks
ADD COLUMN IF NOT EXISTS last_alert_type VARCHAR(50);

-- Add index for webhooks that need alerts
CREATE INDEX IF NOT EXISTS idx_webhooks_failure_count_alert
ON webhooks(failure_count)
WHERE is_active = TRUE AND alert_sent_at IS NULL;

-- Add comment for documentation
COMMENT ON COLUMN webhooks.alert_sent_at IS 'Timestamp when alert was sent for consecutive failures';
COMMENT ON COLUMN webhooks.last_alert_type IS 'Type of last alert sent (e.g., "3_consecutive_failures", "webhook_disabled")';
