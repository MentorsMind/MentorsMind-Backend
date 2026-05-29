-- =============================================================================
-- Migration: 034_create_recommendation_events.sql
-- Description: Create recommendation events table for logging ML training data
-- =============================================================================

CREATE TABLE IF NOT EXISTS recommendation_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Event types: impression (shown), click (clicked), dismiss (dismissed)
    event_type VARCHAR(20) NOT NULL,
    CONSTRAINT check_event_type CHECK (event_type IN ('impression', 'click', 'dismiss')),

    -- Learner who received the recommendation
    learner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Recommended mentor
    mentor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Context information
    context JSONB DEFAULT '{}'::jsonb,
    -- Contains: goals[], session_history_count, skill_gaps[], etc.

    -- Scoring breakdown at time of recommendation (for ML training)
    scoring JSONB DEFAULT '{}'::jsonb,
    -- Contains: skill_match_score, rating_score, availability_score, price_fit_score, total_score

    -- Position in the recommendation list (1-5 typically)
    position INTEGER,

    -- Session/bookings context (if applicable)
    booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,

    -- Device and tracking info
    session_id VARCHAR(255),
    user_agent TEXT,
    ip_address VARCHAR(45),

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for analytics and ML training data retrieval
CREATE INDEX idx_recommendation_events_learner_id ON recommendation_events(learner_id);
CREATE INDEX idx_recommendation_events_mentor_id ON recommendation_events(mentor_id);
CREATE INDEX idx_recommendation_events_event_type ON recommendation_events(event_type);
CREATE INDEX idx_recommendation_events_created_at ON recommendation_events(created_at);

-- Composite index for learner-specific analytics
CREATE INDEX idx_recommendation_events_learner_type ON recommendation_events(learner_id, event_type, created_at);

-- Index for mentor performance analysis
CREATE INDEX idx_recommendation_events_mentor_events ON recommendation_events(mentor_id, event_type, created_at);

-- Dismissed mentors table to exclude from future recommendations
CREATE TABLE IF NOT EXISTS dismissed_recommendations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    learner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mentor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Optional reason
    reason VARCHAR(255),

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Unique constraint: one dismiss per learner-mentor pair
    CONSTRAINT unique_dismissed_mentor UNIQUE (learner_id, mentor_id)
);

CREATE INDEX idx_dismissed_recommendations_learner_id ON dismissed_recommendations(learner_id);

COMMENT ON TABLE recommendation_events IS 'Logs recommendation impressions and interactions for ML training data';
COMMENT ON TABLE dismissed_recommendations IS 'Tracks dismissed mentors per learner for exclusion from future recommendations';