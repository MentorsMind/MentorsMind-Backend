-- Migration: 062_encrypt_webhook_api_keys.sql
-- Encrypt webhook API keys at rest using AES-256-GCM

-- Add encrypted columns
ALTER TABLE webhooks
ADD COLUMN IF NOT EXISTS api_key_encrypted TEXT,
ADD COLUMN IF NOT EXISTS secret_encrypted TEXT,
ADD COLUMN IF NOT EXISTS api_key_encryption_version VARCHAR(32);

-- Add index for key rotation
CREATE INDEX IF NOT EXISTS idx_webhooks_api_key_encryption_version
ON webhooks(api_key_encryption_version)
WHERE api_key_encryption_version IS NOT NULL;

-- Add comments
COMMENT ON COLUMN webhooks.api_key_encrypted IS 'AES-256-GCM encrypted API key';
COMMENT ON COLUMN webhooks.secret_encrypted IS 'AES-256-GCM encrypted webhook secret';
COMMENT ON COLUMN webhooks.api_key_encryption_version IS 'Version of encryption key used for API key encryption';
