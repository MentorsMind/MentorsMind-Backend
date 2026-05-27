-- =============================================================================
-- Migration: 056_create_goal_progress_logs.sql
-- Description: Create goal_progress_logs table for tracking historical progress
-- =============================================================================

CREATE TABLE IF NOT EXISTS goal_progress_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    goal_id UUID NOT NULL REFERENCES learner_goals(id) ON DELETE CASCADE,
    progress INTEGER NOT NULL CHECK (progress >= 0 AND progress <= 100),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for performance
CREATE INDEX idx_goal_progress_logs_goal_id ON goal_progress_logs(goal_id);
CREATE INDEX idx_goal_progress_logs_created_at ON goal_progress_logs(created_at DESC);

-- Add comments
COMMENT ON TABLE goal_progress_logs IS 'Historical logs of progress updates for learning goals';
COMMENT ON COLUMN goal_progress_logs.progress IS 'The progress percentage (0-100) at the time of logging';
COMMENT ON COLUMN goal_progress_logs.notes IS 'Optional notes describing the progress update';
