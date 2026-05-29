-- =============================================================================
-- Migration: 046_create_system_configs.sql
-- Description: Create system_configs table for application configuration
-- =============================================================================

-- Create system_configs table
CREATE TABLE IF NOT EXISTS system_configs (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add comment
COMMENT ON TABLE system_configs IS 'Application configuration key-value store';
COMMENT ON COLUMN system_configs.key IS 'Configuration key (unique identifier)';
COMMENT ON COLUMN system_configs.value IS 'Configuration value stored as JSON';
COMMENT ON COLUMN system_configs.updated_at IS 'Last update timestamp';
