-- =============================================================================
-- Migration: 014_create_flags.sql
-- Description: Create content moderation flags table
-- =============================================================================

-- Create ENUM types for flag status
CREATE TYPE flag_status AS ENUM ('pending', 'approved', 'rejected', 'escalated');
CREATE TYPE flag_entity_type AS ENUM ('review', 'mentor_bio', 'profile_photo', 'user_profile');

-- Create flags table for content moderation
CREATE TABLE IF NOT EXISTS flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Entity being flagged
    entity_type flag_entity_type NOT NULL,
    entity_id UUID NOT NULL,
    
    -- Flagger information
    flagger_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Flag details
    reason TEXT NOT NULL,
    status flag_status NOT NULL DEFAULT 'pending',
    
    -- Moderation details
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    moderator_notes TEXT,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure a user can only flag an entity once
    UNIQUE (entity_type, entity_id, flagger_id)
);

-- Create indexes
CREATE INDEX idx_flags_entity ON flags(entity_type, entity_id);
CREATE INDEX idx_flags_status ON flags(status);
CREATE INDEX idx_flags_flagger_id ON flags(flagger_id);
CREATE INDEX idx_flags_created_at ON flags(created_at);
CREATE INDEX idx_flags_reviewed_by ON flags(reviewed_by) WHERE reviewed_by IS NOT NULL;

-- Add comments
COMMENT ON TABLE flags IS 'Content moderation flags for reviews, bios, and profile photos';
COMMENT ON COLUMN flags.entity_type IS 'Type of content being flagged';
COMMENT ON COLUMN flags.entity_id IS 'ID of the flagged content';
