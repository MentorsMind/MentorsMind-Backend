CREATE TABLE IF NOT EXISTS integration_api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    name VARCHAR(100) NOT NULL,
    provider VARCHAR(50) NOT NULL DEFAULT 'zapier',
    key_hash VARCHAR(128) NOT NULL UNIQUE,
    scopes TEXT[] NOT NULL DEFAULT ARRAY['zapier:*']::TEXT[],
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_used_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS zapier_webhook_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    api_key_id UUID NOT NULL REFERENCES integration_api_keys(id) ON DELETE CASCADE,
    trigger_name VARCHAR(50) NOT NULL,
    target_url TEXT NOT NULL,
    secret VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_triggered_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integration_api_keys_provider_active
    ON integration_api_keys(provider, is_active);
CREATE INDEX IF NOT EXISTS idx_zapier_subscriptions_trigger_active
    ON zapier_webhook_subscriptions(trigger_name, is_active);
