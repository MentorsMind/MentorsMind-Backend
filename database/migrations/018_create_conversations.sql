-- Migration: 018_create_conversations.sql
-- Description: Create conversations table for direct messaging

CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_one_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    participant_two_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_message_id UUID,
    last_message_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- participant_one_id is always the lexicographically smaller UUID
    CONSTRAINT unique_conversation UNIQUE (participant_one_id, participant_two_id),
    CONSTRAINT chk_different_participants CHECK (participant_one_id != participant_two_id)
);

CREATE INDEX idx_conversations_participant_one ON conversations(participant_one_id);
CREATE INDEX idx_conversations_participant_two ON conversations(participant_two_id);
CREATE INDEX idx_conversations_last_message_at ON conversations(last_message_at DESC NULLS LAST);

COMMENT ON TABLE conversations IS 'Direct message conversations between two users';
