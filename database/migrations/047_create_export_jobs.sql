-- =============================================================================
-- Migration: 047_create_export_jobs.sql
-- Description: Create export_jobs table for data export requests
-- =============================================================================

CREATE TABLE IF NOT EXISTS export_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    storage_key TEXT,
    error_message TEXT,
    expires_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for export_jobs
CREATE INDEX IF NOT EXISTS idx_export_jobs_user_id ON export_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_export_jobs_status ON export_jobs(status);
CREATE INDEX IF NOT EXISTS idx_export_jobs_created_at ON export_jobs(created_at);

-- Add comments
COMMENT ON TABLE export_jobs IS 'Data export job requests for user data downloads';
COMMENT ON COLUMN export_jobs.status IS 'Job status: pending, processing, completed, failed';
COMMENT ON COLUMN export_jobs.storage_key IS 'Storage location key for the exported file';
COMMENT ON COLUMN export_jobs.expires_at IS 'Expiration timestamp for the exported file download link';
