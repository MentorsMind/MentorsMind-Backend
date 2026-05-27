-- =============================================================================
-- Migration: 059_create_session_recordings.sql
-- Description: Create session recordings table for recording and playback
-- =============================================================================

CREATE TABLE IF NOT EXISTS session_recordings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    mentor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mentee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Storage information
    s3_key VARCHAR(500) NOT NULL,
    s3_bucket VARCHAR(255) NOT NULL,
    file_size BIGINT,
    duration_seconds INTEGER,
    
    -- Recording status
    status VARCHAR(50) NOT NULL DEFAULT 'recording',
    -- Possible values: 'recording', 'processing', 'ready', 'deleted', 'failed'
    
    -- Consent tracking (privacy compliance)
    mentor_consent BOOLEAN NOT NULL DEFAULT FALSE,
    mentee_consent BOOLEAN NOT NULL DEFAULT FALSE,
    mentor_consent_timestamp TIMESTAMP WITH TIME ZONE,
    mentee_consent_timestamp TIMESTAMP WITH TIME ZONE,
    consent_ip_address VARCHAR(45),
    consent_user_agent TEXT,
    
    -- Recording timeline
    recording_started_at TIMESTAMP WITH TIME ZONE,
    recording_ended_at TIMESTAMP WITH TIME ZONE,
    
    -- Privacy: Auto-delete after 90 days
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    
    -- Playback metadata
    metadata JSONB DEFAULT '{}'::jsonb,
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_session_recordings_session_id ON session_recordings(session_id);
CREATE INDEX idx_session_recordings_mentor_id ON session_recordings(mentor_id);
CREATE INDEX idx_session_recordings_mentee_id ON session_recordings(mentee_id);
CREATE INDEX idx_session_recordings_status ON session_recordings(status);
CREATE INDEX idx_session_recordings_expires_at ON session_recordings(expires_at);
CREATE INDEX idx_session_recordings_created_at ON session_recordings(created_at DESC);

-- Composite index for finding recordings needing cleanup
CREATE INDEX idx_session_recordings_expired ON session_recordings(expires_at) 
    WHERE status IN ('ready', 'processing');

-- Add comments for documentation
COMMENT ON TABLE session_recordings IS 'Stores video/audio recordings of mentoring sessions with consent tracking and automatic deletion';
COMMENT ON COLUMN session_recordings.s3_key IS 'S3 object key for the recording file';
COMMENT ON COLUMN session_recordings.s3_bucket IS 'S3 bucket name where recording is stored';
COMMENT ON COLUMN session_recordings.status IS 'Recording status: recording, processing, ready, deleted, failed';
COMMENT ON COLUMN session_recordings.mentor_consent IS 'Whether mentor consented to recording';
COMMENT ON COLUMN session_recordings.mentee_consent IS 'Whether mentee consented to recording';
COMMENT ON COLUMN session_recordings.expires_at IS 'Auto-delete timestamp (90 days from creation)';
COMMENT ON COLUMN session_recordings.metadata IS 'Additional metadata for playback controls (format, codecs, etc.)';

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_session_recordings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_session_recordings_updated_at
    BEFORE UPDATE ON session_recordings
    FOR EACH ROW
    EXECUTE FUNCTION update_session_recordings_updated_at();
