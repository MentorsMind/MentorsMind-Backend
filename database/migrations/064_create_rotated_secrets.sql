-- Migration: 064_create_rotated_secrets.sql
-- Description: Create tables to support secure, graceful rotation of JWT keys and API keys

CREATE TABLE IF NOT EXISTS rotated_secrets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    secret_type VARCHAR(50) NOT NULL, -- 'jwt_access', 'jwt_refresh', 'db_password'
    secret_value TEXT NOT NULL,       -- Encrypted using EncryptionUtil
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE -- Grace period end
);

CREATE INDEX IF NOT EXISTS idx_rotated_secrets_type_expiry ON rotated_secrets(secret_type, expires_at);

CREATE TABLE IF NOT EXISTS rotated_api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    original_key_id UUID REFERENCES integration_api_keys(id) ON DELETE CASCADE,
    key_hash VARCHAR(128) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rotated_api_keys_hash ON rotated_api_keys(key_hash);

-- Comments
COMMENT ON TABLE rotated_secrets IS 'Secure store for recently rotated keys and passwords during grace periods';
COMMENT ON TABLE rotated_api_keys IS 'Secure store for recently rotated integration API keys during grace periods';
