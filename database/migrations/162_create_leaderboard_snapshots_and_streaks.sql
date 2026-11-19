-- =============================================================================
-- Migration: 162_create_leaderboard_snapshots_and_streaks.sql
-- Description: Create the leaderboard_snapshots and user_activity_streaks tables
--              referenced by leaderboardPrecompute.job.ts / streakTracking.job.ts,
--              plus a 10-session milestone achievement and push-notification
--              trigger seeds for streak milestones (#984).
-- =============================================================================

-- ---------------------------------------------------------------
-- Leaderboard snapshots: nightly pre-computed leaderboards read by
-- the public leaderboard API (leaderboardPrecompute.job.ts)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leaderboard_snapshots (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type        VARCHAR(20) NOT NULL CHECK (type IN ('milestone', 'path', 'global')),
    target_id   UUID,
    period      VARCHAR(20) NOT NULL CHECK (period IN ('week', 'month', 'quarter', 'all')),
    entries     JSONB NOT NULL DEFAULT '[]',
    computed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_leaderboard_snapshots_key UNIQUE (type, target_id, period)
);

COMMENT ON TABLE leaderboard_snapshots IS 'Nightly pre-computed leaderboards surfaced through the public leaderboard API';

-- ---------------------------------------------------------------
-- User activity streaks: per-user daily streak tracking
-- (streakTracking.job.ts), one row per user
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_activity_streaks (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    current_streak   INT NOT NULL DEFAULT 0,
    longest_streak   INT NOT NULL DEFAULT 0,
    last_active_date DATE,
    created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_activity_streaks_current ON user_activity_streaks(current_streak DESC);
CREATE INDEX IF NOT EXISTS idx_user_activity_streaks_user ON user_activity_streaks(user_id);

COMMENT ON TABLE user_activity_streaks IS 'Daily activity streaks used for gamification and streak leaderboards';

-- ---------------------------------------------------------------
-- Add a 10-session milestone achievement (issue #984)
-- Ensures first_session, session_master_10 and streak_30 all exist
-- for the achievement badge system. Achievements table seeded by
-- migration 110; use a safe upsert for idempotency.
-- ---------------------------------------------------------------
INSERT INTO achievements (id, name, description, icon, category, rarity, criteria, reward)
VALUES
  ('session_master_10', 'Decade Decathlete', 'Complete 10 mentoring sessions', 'award-icon-4', 'sessions', 'epic', '{"type": "session_count", "target": 10}'::jsonb, '{"type": "xlm", "value": 5}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------
-- Streak milestone push-notification triggers seed (issue #984):
-- record which streak milestones have already been announced so the
-- push trigger stays idempotent across runs.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS streak_milestone_notifications (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    milestone     INT NOT NULL,
    notified_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_streak_milestone_notifications UNIQUE (user_id, milestone)
);

COMMENT ON TABLE streak_milestone_notifications IS 'Tracks which streak milestones (7, 30, 60...) have already triggered a push notification per user';