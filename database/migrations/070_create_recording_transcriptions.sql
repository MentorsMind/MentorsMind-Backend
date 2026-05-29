-- =============================================================================
-- Migration: 070_create_recording_transcriptions.sql
-- Description: Create transcriptions table for video recordings
-- =============================================================================

CREATE TABLE IF NOT EXISTS recording_transcriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recording_id UUID NOT NULL REFERENCES session_recordings(id) ON DELETE CASCADE,
    
    -- Transcription content
    transcript TEXT NOT NULL,
    language VARCHAR(10) DEFAULT 'en',
    confidence_score DECIMAL(3,2),
    
    -- Transcription metadata
    provider VARCHAR(50) NOT NULL, -- aws, google, openai
    provider_job_id VARCHAR(255),
    word_count INTEGER,
    duration_seconds DECIMAL(10,2),
    
    -- Processing status
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    -- Possible values: 'pending', 'processing', 'completed', 'failed'
    
    -- Timestamps
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_recording_transcriptions_recording_id ON recording_transcriptions(recording_id);
CREATE INDEX idx_recording_transcriptions_status ON recording_transcriptions(status);
CREATE INDEX idx_recording_transcriptions_language ON recording_transcriptions(language);
CREATE INDEX idx_recording_transcriptions_provider ON recording_transcriptions(provider);

-- Add comments for documentation
COMMENT ON TABLE recording_transcriptions IS 'Stores video transcriptions for session recordings with multi-provider support';
COMMENT ON COLUMN recording_transcriptions.transcript IS 'Full text transcription of the recording';
COMMENT ON COLUMN recording_transcriptions.confidence_score IS 'Transcription accuracy confidence (0.00 to 1.00)';
COMMENT ON COLUMN recording_transcriptions.provider IS 'Transcription service provider (aws, google, openai)';
COMMENT ON COLUMN recording_transcriptions.status IS 'Transcription processing status';

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_recording_transcriptions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_recording_transcriptions_updated_at
    BEFORE UPDATE ON recording_transcriptions
    FOR EACH ROW
    EXECUTE FUNCTION update_recording_transcriptions_updated_at();
