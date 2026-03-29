-- =============================================================================
-- Migration: 042_create_consent_records.sql
-- Description: Create cookie consent records table for user preference tracking
-- =============================================================================

CREATE TABLE IF NOT EXISTS consent_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    analytics_consent BOOLEAN NOT NULL DEFAULT FALSE,
    marketing_consent BOOLEAN NOT NULL DEFAULT FALSE,
    functional_consent BOOLEAN NOT NULL DEFAULT FALSE,
    
    consent_timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    ip_address VARCHAR(45), -- Supports both IPv4 and IPv6
    user_agent TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for searching user's latest consent
CREATE INDEX idx_consent_records_user_id ON consent_records(user_id);
CREATE INDEX idx_consent_records_timestamp ON consent_records(consent_timestamp DESC);

-- Add comments for documentation
COMMENT ON TABLE consent_records IS 'Stores append-only records of user cookie consent choices';
COMMENT ON COLUMN consent_records.analytics_consent IS 'Whether the user consented to analytics cookies';
COMMENT ON COLUMN consent_records.marketing_consent IS 'Whether the user consented to marketing cookies';
COMMENT ON COLUMN consent_records.functional_consent IS 'Whether the user consented to functional cookies';
COMMENT ON COLUMN consent_records.ip_address IS 'The IP address from which the consent was given';
COMMENT ON COLUMN consent_records.user_agent IS 'The user agent string at the time of consent';
