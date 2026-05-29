-- Migration: 020_create_message_attachments.sql
-- Description: Create message_attachments table and daily upload quota tracking

CREATE TABLE IF NOT EXISTS message_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    uploader_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    file_size INTEGER NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    storage_key VARCHAR(500) NOT NULL,
    storage_bucket VARCHAR(255) NOT NULL DEFAULT 'attachments',
    scan_status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (scan_status IN ('pending', 'clean', 'infected', 'error')),
    scanned_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Per-user daily upload quota tracking
CREATE TABLE IF NOT EXISTS user_upload_quotas (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    quota_date DATE NOT NULL DEFAULT CURRENT_DATE,
    bytes_used BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, quota_date)
);

CREATE INDEX idx_attachments_message_id ON message_attachments(message_id);
CREATE INDEX idx_attachments_conversation_id ON message_attachments(conversation_id);
CREATE INDEX idx_attachments_uploader ON message_attachments(uploader_id);
CREATE INDEX idx_upload_quotas_user_date ON user_upload_quotas(user_id, quota_date);

COMMENT ON TABLE message_attachments IS 'File attachments linked to messages';
COMMENT ON TABLE user_upload_quotas IS 'Daily upload byte quota per user (max 50 MB/day)';
COMMENT ON COLUMN message_attachments.scan_status IS 'Virus scan result: pending|clean|infected|error';
