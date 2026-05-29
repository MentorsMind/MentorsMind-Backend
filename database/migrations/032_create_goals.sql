-- =============================================================================
-- Migration: 032_create_goals.sql
-- Description: Create learner_goals and goal_bookings linking for progress tracking
-- =============================================================================

-- Drop existing structure if legacy 011 exists with wrong types
-- WARNING: This is for fresh feature implementation where 011 was a placeholder
DROP TABLE IF EXISTS learner_goals CASCADE;

-- Create ENUM for goal status if it doesn't exist
DO $$ BEGIN
    CREATE TYPE goal_status AS ENUM ('active', 'completed', 'paused');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create learner_goals table
CREATE TABLE learner_goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    learner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    target_date DATE,
    progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    status goal_status NOT NULL DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Join table for linking goals with mentorship sessions (bookings)
CREATE TABLE goal_bookings (
    goal_id UUID NOT NULL REFERENCES learner_goals(id) ON DELETE CASCADE,
    booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (goal_id, booking_id)
);

-- Indexes for performance
CREATE INDEX idx_learner_goals_learner_id ON learner_goals(learner_id);
CREATE INDEX idx_learner_goals_status ON learner_goals(status);
CREATE INDEX idx_learner_goals_target_date ON learner_goals(target_date ASC);
CREATE INDEX idx_goal_bookings_booking_id ON goal_bookings(booking_id);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_learner_goals_updated_at
    BEFORE UPDATE ON learner_goals
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Add comments
COMMENT ON TABLE learner_goals IS 'Learning goals set by mentees to track their mentorship progress';
COMMENT ON TABLE goal_bookings IS 'Links individual mentorship sessions (bookings) to specific learning goals';
