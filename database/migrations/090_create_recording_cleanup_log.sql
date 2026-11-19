-- =============================================================================
-- Migration: 090_create_recording_cleanup_log.sql
-- Description: Audit table for S3 recording cleanup job — soft-delete pattern
--              with 7-day pending window before hard deletion, 30-day log retention.
-- =============================================================================

CREATE TABLE IF NOT EXISTS recording_cleanup_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The S3 object that was (or will be) deleted
    s3_key VARCHAR(500) NOT NULL,
    s3_bucket VARCHAR(255) NOT NULL,
    file_size_bytes BIGINT DEFAULT 0,

    -- Classification
    -- orphan: S3 object with no matching session_recordings row
    -- expired: DB record exists but recording has passed its expires_at
    -- incomplete_multipart: aborted multipart upload
    cleanup_reason VARCHAR(50) NOT NULL,
    -- Possible values: 'orphan', 'expired', 'incomplete_multipart'

    -- Soft-delete lifecycle
    -- pending_deletion  → marked for deletion, within 7-day recovery window
    -- deleted           → hard-deleted from S3
    -- recovered         → admin rescued the object before hard deletion
    deletion_status VARCHAR(30) NOT NULL DEFAULT 'pending_deletion',

    -- Timestamps
    detected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    -- When the object will be / was hard-deleted from S3
    scheduled_deletion_at TIMESTAMP WITH TIME ZONE NOT NULL
        DEFAULT (NOW() + INTERVAL '7 days'),
    deleted_at TIMESTAMP WITH TIME ZONE,
    recovered_at TIMESTAMP WITH TIME ZONE,

    -- For multipart upload aborts
    upload_id VARCHAR(1024),
    upload_initiated_at TIMESTAMP WITH TIME ZONE,

    -- If the orphan matched a session_recordings row that was already deleted
    -- (e.g., the DB row was deleted but the S3 object remained)
    related_recording_id UUID,
    related_session_id UUID,

    -- Job run that discovered this orphan (for grouping cleanup reports)
    job_run_id UUID NOT NULL,

    -- Audit: who triggered the cleanup (system / admin override)
    triggered_by VARCHAR(100) NOT NULL DEFAULT 'system',

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_recording_cleanup_log_deletion_status
    ON recording_cleanup_log(deletion_status);

CREATE INDEX idx_recording_cleanup_log_scheduled_deletion_at
    ON recording_cleanup_log(scheduled_deletion_at)
    WHERE deletion_status = 'pending_deletion';

CREATE INDEX idx_recording_cleanup_log_job_run_id
    ON recording_cleanup_log(job_run_id);

CREATE INDEX idx_recording_cleanup_log_s3_key
    ON recording_cleanup_log(s3_key);

CREATE INDEX idx_recording_cleanup_log_detected_at
    ON recording_cleanup_log(detected_at DESC);

-- Auto-expire log rows older than 30 days (ttl index for periodic purge)
CREATE INDEX idx_recording_cleanup_log_ttl
    ON recording_cleanup_log(created_at)
    WHERE deletion_status IN ('deleted', 'recovered');

-- Comments
COMMENT ON TABLE recording_cleanup_log IS
    'Audit trail for S3 orphan cleanup and incomplete multipart upload aborts. '
    'Rows with deletion_status=pending_deletion are within the 7-day recovery window. '
    'Purge rows older than 30 days via the weekly cleanup job.';

COMMENT ON COLUMN recording_cleanup_log.cleanup_reason IS
    'orphan | expired | incomplete_multipart';

COMMENT ON COLUMN recording_cleanup_log.deletion_status IS
    'pending_deletion | deleted | recovered';

COMMENT ON COLUMN recording_cleanup_log.scheduled_deletion_at IS
    'Computed column: detected_at + 7 days. Hard deletion happens after this timestamp.';

COMMENT ON COLUMN recording_cleanup_log.job_run_id IS
    'UUID generated per job execution — groups all records from a single cleanup run.';

-- Trigger: keep updated_at current
CREATE OR REPLACE FUNCTION update_recording_cleanup_log_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_recording_cleanup_log_updated_at
    BEFORE UPDATE ON recording_cleanup_log
    FOR EACH ROW
    EXECUTE FUNCTION update_recording_cleanup_log_updated_at();
