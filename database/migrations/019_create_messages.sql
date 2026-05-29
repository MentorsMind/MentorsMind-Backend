-- Migration: 019_create_messages.sql
-- Description: Create messages table for direct messaging

CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMP WITH TIME ZONE,
    read_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add FK for conversations.last_message_id after messages table exists
ALTER TABLE conversations
    ADD CONSTRAINT fk_last_message
    FOREIGN KEY (last_message_id) REFERENCES messages(id) ON DELETE SET NULL;

CREATE INDEX idx_messages_conversation_id ON messages(conversation_id, created_at DESC);
CREATE INDEX idx_messages_sender_id ON messages(sender_id);
CREATE INDEX idx_messages_conversation_not_deleted ON messages(conversation_id) WHERE is_deleted = FALSE;

-- GIN index for full-text search (migration 021)
CREATE INDEX idx_messages_body_fts ON messages USING GIN(to_tsvector('english', body));

COMMENT ON TABLE messages IS 'Messages within a conversation';
COMMENT ON COLUMN messages.is_deleted IS 'Soft-delete flag — body hidden but row kept for audit';
