-- =============================================================================
-- Migration: 090_create_review_responses.sql
-- Description: Add mentor responses to reviews
-- =============================================================================

CREATE TABLE IF NOT EXISTS review_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    mentor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    response_text VARCHAR(1000) NOT NULL,
    is_published BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(review_id)
);

CREATE INDEX IF NOT EXISTS idx_review_responses_review_id ON review_responses(review_id);
CREATE INDEX IF NOT EXISTS idx_review_responses_mentor_id ON review_responses(mentor_id);
CREATE INDEX IF NOT EXISTS idx_review_responses_published ON review_responses(is_published)
    WHERE is_published = TRUE;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_review_responses_updated_at'
    ) THEN
        CREATE TRIGGER trigger_review_responses_updated_at
            BEFORE UPDATE ON review_responses
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

COMMENT ON TABLE review_responses IS 'Public mentor responses to student reviews';
COMMENT ON COLUMN review_responses.response_text IS 'Mentor reply text, limited to 1000 characters';
