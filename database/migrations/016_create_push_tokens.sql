-- =============================================================================
-- Migration: 016_create_push_tokens.sql
-- Description: Create push_tokens table for FCM device tokens
-- =============================================================================

-- Create push_tokens table
CREATE TABLE IF NOT EXISTS push_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    device_type VARCHAR(50),
    device_id VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE,
    last_used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, token)
);

-- Create indexes for push_tokens
CREATE INDEX idx_push_tokens_user_id ON push_tokens(user_id);
CREATE INDEX idx_push_tokens_token ON push_tokens(token);
CREATE INDEX idx_push_tokens_active ON push_tokens(user_id, is_active) WHERE is_active = TRUE;

-- Add comments
COMMENT ON TABLE push_tokens IS 'FCM device tokens for push notifications';
COMMENT ON COLUMN push_tokens.token IS 'Firebase Cloud Messaging device token';
COMMENT ON COLUMN push_tokens.device_type IS 'Device type (web, android, ios)';
COMMENT ON COLUMN push_tokens.device_id IS 'Unique device identifier';
COMMENT ON COLUMN push_tokens.is_active IS 'Whether the token is still valid';
COMMENT ON COLUMN push_tokens.last_used_at IS 'Last time this token was successfully used';
