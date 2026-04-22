-- Migration: 035_create_data_export_requests.sql
-- Description: Create table for tracking GDPR data export requests

CREATE TYPE data_export_status AS ENUM (
    'pending',
    'processing',
    'completed',
    'failed',
    'expired'
);

CREATE TABLE IF NOT EXISTS data_export_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status data_export_status NOT NULL DEFAULT 'pending',
    file_path TEXT, -- path in storage (e.g. S3 or local)
    file_size BIGINT,
    checksum VARCHAR(64),
    error_message TEXT,
    requested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    processed_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    download_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_data_export_user_id ON data_export_requests(user_id);
CREATE INDEX idx_data_export_status ON data_export_requests(status);
CREATE INDEX idx_data_export_requested_at ON data_export_requests(requested_at);

-- Rate limit: check if user already has a pending or recent request
-- Note: Rate limit logic is implemented in service, but we index for performance
CREATE INDEX idx_data_export_rate_limit ON data_export_requests(user_id, requested_at DESC);

COMMENT ON TABLE data_export_requests IS 'Tracking table for GDPR user data export requests';
