-- =============================================================================
-- Migration: 065_create_ai_moderation_results.sql
-- Description: Store AI-powered moderation scan results per content item.
--              Supports OpenAI Moderation API, Perspective API, and heuristic
--              fallback results referenced from issue #508.
-- =============================================================================

CREATE TYPE ai_moderation_provider AS ENUM ('openai', 'perspective', 'heuristic');
CREATE TYPE ai_moderation_severity AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE ai_moderation_action AS ENUM ('allow', 'review', 'hide', 'block');

CREATE TABLE IF NOT EXISTS ai_moderation_results (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- What was scanned
    content_id       TEXT NOT NULL,
    content_type     TEXT NOT NULL,          -- 'profile' | 'review' | 'message'

    -- Outcome
    provider         ai_moderation_provider NOT NULL,
    severity         ai_moderation_severity NOT NULL DEFAULT 'low',
    action           ai_moderation_action   NOT NULL DEFAULT 'allow',
    confidence       NUMERIC(5, 4)          NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),

    -- Structured flags (array of {category, score, description})
    flags            JSONB                  NOT NULL DEFAULT '[]',

    -- Raw provider scores for audit / reprocessing
    raw_scores       JSONB,

    -- Whether a human moderator has reviewed this AI result
    human_reviewed   BOOLEAN                NOT NULL DEFAULT FALSE,
    reviewed_by      UUID                   REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at      TIMESTAMP WITH TIME ZONE,
    reviewer_notes   TEXT,

    created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for looking up all AI results for a piece of content
CREATE INDEX idx_ai_mod_content ON ai_moderation_results(content_type, content_id);
-- Index for finding un-reviewed items that need human attention
CREATE INDEX idx_ai_mod_pending_review
    ON ai_moderation_results(action, human_reviewed)
    WHERE action IN ('review', 'hide', 'block') AND human_reviewed = FALSE;
-- Index for severity-based dashboards
CREATE INDEX idx_ai_mod_severity ON ai_moderation_results(severity);

COMMENT ON TABLE  ai_moderation_results IS 'Stores results from AI-powered automated content moderation scans';
COMMENT ON COLUMN ai_moderation_results.content_id   IS 'UUID or string ID of the scanned content';
COMMENT ON COLUMN ai_moderation_results.content_type IS 'profile | review | message';
COMMENT ON COLUMN ai_moderation_results.flags        IS 'Array of ModerationFlag objects: [{category, score, description}]';
COMMENT ON COLUMN ai_moderation_results.raw_scores   IS 'Raw attribute scores returned by the AI provider';
