-- =============================================================================
-- Migration: 054_add_deletion_error_tracking.sql
-- Description: Add error tracking columns for failed account deletions
-- =============================================================================

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS deletion_failed_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS deletion_error TEXT,
    ADD COLUMN IF NOT EXISTS deletion_retry_count INTEGER DEFAULT 0;

-- Index for finding failed deletions that need retry
CREATE INDEX IF NOT EXISTS idx_users_deletion_failed
    ON users(deletion_failed_at)
    WHERE deletion_failed_at IS NOT NULL AND deletion_completed_at IS NULL;

COMMENT ON COLUMN users.deletion_failed_at IS 'Timestamp when the last deletion attempt failed';
COMMENT ON COLUMN users.deletion_error IS 'Error message from the last failed deletion attempt';
COMMENT ON COLUMN users.deletion_retry_count IS 'Number of times deletion has been retried';
