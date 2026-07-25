-- =============================================================================
-- Migration: 091_create_deprecation_notifications.sql
-- Description: Track deprecation notification sends for active API consumers.
-- =============================================================================

CREATE TABLE IF NOT EXISTS deprecation_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    api_key_id UUID REFERENCES integration_api_keys(id) ON DELETE SET NULL,
    api_version TEXT NOT NULL DEFAULT 'v1',
    endpoint_count INTEGER NOT NULL DEFAULT 0,
    endpoints_used JSONB NOT NULL DEFAULT '[]',
    call_count INTEGER NOT NULL DEFAULT 0,
    last_seen_at TIMESTAMPTZ NOT NULL,
    email_address VARCHAR(320) NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deprecation_notifications_user_sent_at
    ON deprecation_notifications(user_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_deprecation_notifications_api_key_sent_at
    ON deprecation_notifications(api_key_id, sent_at DESC)
    WHERE api_key_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_deprecation_notifications_version_sent_at
    ON deprecation_notifications(api_version, sent_at DESC);

CREATE OR REPLACE FUNCTION update_deprecation_notifications_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_deprecation_notifications_updated_at ON deprecation_notifications;
CREATE TRIGGER trg_deprecation_notifications_updated_at
    BEFORE UPDATE ON deprecation_notifications
    FOR EACH ROW
    EXECUTE FUNCTION update_deprecation_notifications_updated_at();

COMMENT ON TABLE deprecation_notifications IS 'Stores API deprecation notification sends for duplicate suppression and auditability';
COMMENT ON COLUMN deprecation_notifications.endpoints_used IS 'Array of deprecated endpoints used by the recipient in the lookback window';
