-- =============================================================================
-- Migration: 024_create_oauth_accounts.sql
-- Description: Create oauth_accounts table for OAuth2 social login providers
-- =============================================================================

-- Create ENUM type for OAuth providers
CREATE TYPE oauth_provider AS ENUM ('google', 'github');

-- Create oauth_accounts table
CREATE TABLE IF NOT EXISTS oauth_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- User reference
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- OAuth provider information
    provider oauth_provider NOT NULL,
    provider_account_id VARCHAR(255) NOT NULL, -- Unique ID from OAuth provider
    
    -- OAuth tokens (encrypted at rest)
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at TIMESTAMP WITH TIME ZONE,
    
    -- Provider-specific profile data
    provider_email VARCHAR(255),
    provider_name VARCHAR(255),
    provider_avatar_url VARCHAR(500),
    
    -- Metadata
    metadata JSONB DEFAULT '{}'::jsonb,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure unique combination of provider and provider_account_id
    CONSTRAINT unique_provider_account UNIQUE (provider, provider_account_id),
    
    -- Ensure unique combination of user_id and provider (one account per provider per user)
    CONSTRAINT unique_user_provider UNIQUE (user_id, provider)
);

-- Create indexes for performance
CREATE INDEX idx_oauth_accounts_user_id ON oauth_accounts(user_id);
CREATE INDEX idx_oauth_accounts_provider ON oauth_accounts(provider);
CREATE INDEX idx_oauth_accounts_provider_account_id ON oauth_accounts(provider, provider_account_id);
CREATE INDEX idx_oauth_accounts_provider_email ON oauth_accounts(provider_email) WHERE provider_email IS NOT NULL;

-- Add comments for documentation
COMMENT ON TABLE oauth_accounts IS 'Stores OAuth2 social login accounts linked to users';
COMMENT ON COLUMN oauth_accounts.provider_account_id IS 'Unique identifier from the OAuth provider (e.g., Google sub, GitHub id)';
COMMENT ON COLUMN oauth_accounts.access_token IS 'OAuth access token (should be encrypted in production)';
COMMENT ON COLUMN oauth_accounts.refresh_token IS 'OAuth refresh token (should be encrypted in production)';
COMMENT ON COLUMN oauth_accounts.provider_email IS 'Email address from OAuth provider (may differ from user email)';
COMMENT ON COLUMN oauth_accounts.metadata IS 'Additional provider-specific data';
