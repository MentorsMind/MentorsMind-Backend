-- =============================================================================
-- Migration: 071_create_recording_bookmarks.sql
-- Description: Create bookmarks and annotations table for recordings
-- =============================================================================

CREATE TABLE IF NOT EXISTS recording_bookmarks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recording_id UUID NOT NULL REFERENCES session_recordings(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Bookmark/annotation details
    type VARCHAR(50) NOT NULL DEFAULT 'bookmark',
    -- Possible values: 'bookmark', 'annotation', 'highlight'
    
    -- Timestamp in the recording (seconds)
    timestamp_seconds DECIMAL(10,2) NOT NULL,
    
    -- Content
    title VARCHAR(255),
    note TEXT,
    
    -- Annotation-specific fields
    color VARCHAR(7), -- Hex color code for highlights
    duration_seconds DECIMAL(10,2), -- For highlighting a range
    
    -- Visibility
    is_private BOOLEAN NOT NULL DEFAULT TRUE,
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_recording_bookmarks_recording_id ON recording_bookmarks(recording_id);
CREATE INDEX idx_recording_bookmarks_user_id ON recording_bookmarks(user_id);
CREATE INDEX idx_recording_bookmarks_type ON recording_bookmarks(type);
CREATE INDEX idx_recording_bookmarks_timestamp ON recording_bookmarks(recording_id, timestamp_seconds);
CREATE INDEX idx_recording_bookmarks_is_private ON recording_bookmarks(is_private);

-- Unique constraint to prevent duplicate bookmarks at same timestamp
CREATE UNIQUE INDEX idx_recording_bookmarks_unique_timestamp 
    ON recording_bookmarks(recording_id, user_id, timestamp_seconds) 
    WHERE type = 'bookmark';

-- Add comments for documentation
COMMENT ON TABLE recording_bookmarks IS 'Stores bookmarks and annotations for session recordings';
COMMENT ON COLUMN recording_bookmarks.type IS 'Type of marker: bookmark, annotation, or highlight';
COMMENT ON COLUMN recording_bookmarks.timestamp_seconds IS 'Position in the recording in seconds';
COMMENT ON COLUMN recording_bookmarks.color IS 'Hex color code for highlight annotations';
COMMENT ON COLUMN recording_bookmarks.duration_seconds IS 'Duration for highlight ranges in seconds';
COMMENT ON COLUMN recording_bookmarks.is_private IS 'Whether bookmark is private to the user';

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_recording_bookmarks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_recording_bookmarks_updated_at
    BEFORE UPDATE ON recording_bookmarks
    FOR EACH ROW
    EXECUTE FUNCTION update_recording_bookmarks_updated_at();
