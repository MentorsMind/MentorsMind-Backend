-- =============================================================================
-- Migration: 164_create_api_sunset_exemptions.sql
-- Description: Allowlist of users permitted to keep calling an API version
--              after its sunsetAt date (gradual sunset enforcement).
-- =============================================================================

CREATE TABLE IF NOT EXISTS api_sunset_exemptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    api_version VARCHAR(10) NOT NULL,
    reason TEXT,
    granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT api_sunset_exemptions_user_version_unique UNIQUE (user_id, api_version)
);

CREATE INDEX IF NOT EXISTS idx_api_sunset_exemptions_user_version
    ON api_sunset_exemptions(user_id, api_version);

CREATE INDEX IF NOT EXISTS idx_api_sunset_exemptions_version
    ON api_sunset_exemptions(api_version);

CREATE INDEX IF NOT EXISTS idx_api_sunset_exemptions_expires_at
    ON api_sunset_exemptions(expires_at)
    WHERE expires_at IS NOT NULL;

DROP TRIGGER IF EXISTS trigger_api_sunset_exemptions_updated_at ON api_sunset_exemptions;
CREATE TRIGGER trigger_api_sunset_exemptions_updated_at
    BEFORE UPDATE ON api_sunset_exemptions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE api_sunset_exemptions IS 'Users exempt from HTTP 410 sunset enforcement for a specific API version';
