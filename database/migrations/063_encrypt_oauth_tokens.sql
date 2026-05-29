-- Migration: 063_encrypt_oauth_tokens.sql
-- Encrypt OAuth access and refresh tokens at rest using AES-256-GCM

-- Add encrypted columns
ALTER TABLE oauth_accounts
ADD COLUMN IF NOT EXISTS access_token_encrypted TEXT,
ADD COLUMN IF NOT EXISTS refresh_token_encrypted TEXT,
ADD COLUMN IF NOT EXISTS token_encryption_version VARCHAR(32);

-- Add index for key rotation
CREATE INDEX IF NOT EXISTS idx_oauth_accounts_token_encryption_version
ON oauth_accounts(token_encryption_version)
WHERE token_encryption_version IS NOT NULL;

-- Add comments
COMMENT ON COLUMN oauth_accounts.access_token_encrypted IS 'AES-256-GCM encrypted OAuth access token';
COMMENT ON COLUMN oauth_accounts.refresh_token_encrypted IS 'AES-256-GCM encrypted OAuth refresh token';
COMMENT ON COLUMN oauth_accounts.token_encryption_version IS 'Version of encryption key used for token encryption';
