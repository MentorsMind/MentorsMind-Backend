CREATE TABLE IF NOT EXISTS session_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    mentor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mentee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating_content INTEGER NOT NULL CHECK (rating_content BETWEEN 1 AND 5),
    rating_communication INTEGER NOT NULL CHECK (rating_communication BETWEEN 1 AND 5),
    rating_preparation INTEGER NOT NULL CHECK (rating_preparation BETWEEN 1 AND 5),
    rating_value INTEGER NOT NULL CHECK (rating_value BETWEEN 1 AND 5),
    quality_score NUMERIC(4,2) GENERATED ALWAYS AS (
        (rating_content + rating_communication + rating_preparation + rating_value)::NUMERIC / 4.0
    ) STORED,
    sentiment VARCHAR(10) NOT NULL DEFAULT 'neutral' CHECK (sentiment IN ('positive', 'neutral', 'negative')),
    comment TEXT,
    improvements TEXT[],
    would_recommend BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (session_id, mentee_id)
);

CREATE INDEX IF NOT EXISTS idx_session_feedback_mentor ON session_feedback(mentor_id);
CREATE INDEX IF NOT EXISTS idx_session_feedback_session ON session_feedback(session_id);
CREATE INDEX IF NOT EXISTS idx_session_feedback_quality ON session_feedback(quality_score);
