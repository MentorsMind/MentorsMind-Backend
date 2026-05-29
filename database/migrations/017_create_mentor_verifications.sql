-- =============================================================================
-- Migration: 017_create_mentor_verifications.sql
-- Description: Mentor identity and credential verification workflow (Issue #103)
-- =============================================================================

CREATE TYPE verification_status AS ENUM (
    'pending',
    'approved',
    'rejected',
    'more_info_requested',
    'expired'
);

CREATE TABLE IF NOT EXISTS mentor_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Mentor reference
    mentor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Submitted documents
    document_type VARCHAR(50) NOT NULL,   -- passport, national_id, drivers_license
    document_url  VARCHAR(500) NOT NULL,
    credential_url VARCHAR(500),          -- optional credential / certificate
    linkedin_url  VARCHAR(500),
    additional_notes TEXT,

    -- Review state
    status verification_status NOT NULL DEFAULT 'pending',
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    rejection_reason TEXT,
    additional_info_request TEXT,

    -- On-chain verification
    on_chain_tx_hash VARCHAR(100),

    -- Expiry (1 year from approval)
    expires_at TIMESTAMP WITH TIME ZONE,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_mentor_verifications_mentor_id ON mentor_verifications(mentor_id);
CREATE INDEX idx_mentor_verifications_status    ON mentor_verifications(status);
CREATE INDEX idx_mentor_verifications_expires_at ON mentor_verifications(expires_at)
    WHERE expires_at IS NOT NULL;

-- Add is_verified flag to users table if not present
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'is_verified'
    ) THEN
        ALTER TABLE users ADD COLUMN is_verified BOOLEAN NOT NULL DEFAULT FALSE;
    END IF;
END $$;

COMMENT ON TABLE mentor_verifications IS 'Mentor identity and credential verification submissions';
COMMENT ON COLUMN mentor_verifications.expires_at IS 'Verification expires 1 year after approval';
COMMENT ON COLUMN mentor_verifications.on_chain_tx_hash IS 'Stellar transaction hash for on-chain verification';
