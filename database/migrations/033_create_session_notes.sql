-- =============================================================================
-- Migration: 033_create_session_notes.sql
-- Description: Create session notes table with GIN full-text search index
-- =============================================================================

CREATE TABLE IF NOT EXISTS session_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Relationship to the session
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    
    -- The learner who owns this note (private)
    learner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Note content (rich text stored as plain text, max 10,000 chars)
    content TEXT NOT NULL,
    CONSTRAINT check_content_length CHECK (char_length(content) <= 10000),
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for session-specific note retrieval
CREATE INDEX idx_session_notes_session_id ON session_notes(session_id);

-- Index for learner-specific note retrieval and privacy checks
CREATE INDEX idx_session_notes_learner_id ON session_notes(learner_id);

-- GIN index for full-text search on content
-- Using to_tsvector with english configuration
CREATE INDEX idx_session_notes_content_fts ON session_notes USING GIN (to_tsvector('english', content));

-- Trigger to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_session_notes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER trg_session_notes_updated_at
    BEFORE UPDATE ON session_notes
    FOR EACH ROW
    EXECUTE FUNCTION update_session_notes_updated_at();

COMMENT ON TABLE session_notes IS 'Private learner notes for mentoring sessions with full-text search support';
COMMENT ON COLUMN session_notes.content IS 'Plain text content of the note, limited to 10,000 characters';
