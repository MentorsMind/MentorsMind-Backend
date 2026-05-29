ALTER TABLE users
    ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS deletion_scheduled_for TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS deletion_cancelled_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS deletion_completed_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS token_invalid_before TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_users_deletion_scheduled_for
    ON users(deletion_scheduled_for)
    WHERE deletion_requested_at IS NOT NULL AND deletion_completed_at IS NULL;
