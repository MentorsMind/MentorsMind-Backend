-- Migration 044: Security Hardening and Reliability Fixes
-- 1. Add encrypted OAuth token columns to users
-- 2. Add missing on_chain_pending column to mentor_verifications

-- Add encryption columns to users
ALTER TABLE users
ADD COLUMN IF NOT EXISTS encrypted_access_token TEXT,
ADD COLUMN IF NOT EXISTS encrypted_refresh_token TEXT;

-- Add pii_encryption_version if not exists (it should be there from 041)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'pii_encryption_version'
    ) THEN
        ALTER TABLE users ADD COLUMN pii_encryption_version VARCHAR(32);
    END IF;
END $$;

-- Add missing on_chain_pending to mentor_verifications
ALTER TABLE mentor_verifications
ADD COLUMN IF NOT EXISTS on_chain_pending BOOLEAN DEFAULT FALSE;

-- Index for on_chain_pending to support retry jobs
CREATE INDEX IF NOT EXISTS idx_mentor_verifications_on_chain_pending 
ON mentor_verifications(on_chain_pending) 
WHERE on_chain_pending = TRUE;

-- Comments
COMMENT ON COLUMN users.encrypted_access_token IS 'Encrypted Google OAuth access token';
COMMENT ON COLUMN users.encrypted_refresh_token IS 'Encrypted Google OAuth refresh token';
COMMENT ON COLUMN mentor_verifications.on_chain_pending IS 'Flag for background retry of Stellar on-chain verification';
