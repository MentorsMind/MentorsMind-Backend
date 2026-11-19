-- Migration 110: Create Gamification & Achievement System tables
--
-- Includes achievements, user_gamification_progress, user_achievements,
-- challenges, user_challenge_progress, and rewards_log.

CREATE TABLE IF NOT EXISTS achievements (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  icon        TEXT NOT NULL,
  category    TEXT NOT NULL CHECK (category IN ('sessions', 'learning', 'social', 'special')),
  rarity      TEXT NOT NULL CHECK (rarity IN ('common', 'rare', 'epic', 'legendary')),
  criteria    JSONB NOT NULL DEFAULT '{}'::jsonb,
  reward      JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_gamification_progress (
  user_id             UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  level               INTEGER NOT NULL DEFAULT 1,
  xp                  BIGINT NOT NULL DEFAULT 0,
  streak              INTEGER NOT NULL DEFAULT 0,
  last_activity_date  DATE,
  streak_freeze_count INTEGER NOT NULL DEFAULT 0,
  showcase_badges     JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_achievements (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  unlocked_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  claimed_reward BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT unique_user_achievement UNIQUE (user_id, achievement_id)
);

CREATE TABLE IF NOT EXISTS challenges (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('daily', 'weekly')),
  goal_count  INTEGER NOT NULL DEFAULT 1,
  category    TEXT NOT NULL DEFAULT 'sessions',
  criteria    JSONB NOT NULL DEFAULT '{}'::jsonb,
  reward      JSONB NOT NULL DEFAULT '{}'::jsonb,
  start_date  TIMESTAMP WITH TIME ZONE,
  end_date    TIMESTAMP WITH TIME ZONE,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_challenge_progress (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge_id   UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  current_count  INTEGER NOT NULL DEFAULT 0,
  completed      BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at   TIMESTAMP WITH TIME ZONE,
  reward_claimed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_user_challenge UNIQUE (user_id, challenge_id)
);

CREATE TABLE IF NOT EXISTS rewards_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reward_type TEXT NOT NULL CHECK (reward_type IN ('xp', 'xlm', 'discount', 'badge')),
  amount      NUMERIC NOT NULL DEFAULT 0,
  source      TEXT NOT NULL CHECK (source IN ('achievement', 'challenge', 'streak', 'level_up', 'manual')),
  source_id   TEXT,
  status      TEXT NOT NULL DEFAULT 'granted' CHECK (status IN ('granted', 'claimed', 'failed')),
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_gamification_xp ON user_gamification_progress(xp DESC);
CREATE INDEX IF NOT EXISTS idx_user_gamification_level ON user_gamification_progress(level DESC);
CREATE INDEX IF NOT EXISTS idx_user_gamification_streak ON user_gamification_progress(streak DESC);
CREATE INDEX IF NOT EXISTS idx_user_achievements_user ON user_achievements(user_id);
CREATE INDEX IF NOT EXISTS idx_user_achievements_achievement ON user_achievements(achievement_id);
CREATE INDEX IF NOT EXISTS idx_user_challenge_user ON user_challenge_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_user_challenge_challenge ON user_challenge_progress(challenge_id);
CREATE INDEX IF NOT EXISTS idx_rewards_log_user ON rewards_log(user_id);

-- Default Achievements Seed
INSERT INTO achievements (id, name, description, icon, category, rarity, criteria, reward)
VALUES
  ('first_session', 'First Step', 'Complete your first mentoring session', 'award-icon-1', 'sessions', 'common', '{"type": "session_count", "target": 1}'::jsonb, '{"type": "xp", "value": 100}'::jsonb),
  ('session_master_5', 'Rising Star', 'Complete 5 mentoring sessions', 'award-icon-2', 'sessions', 'rare', '{"type": "session_count", "target": 5}'::jsonb, '{"type": "xp", "value": 500}'::jsonb),
  ('session_master_25', 'Master Mentor', 'Complete 25 mentoring sessions', 'award-icon-3', 'sessions', 'epic', '{"type": "session_count", "target": 25}'::jsonb, '{"type": "xlm", "value": 10}'::jsonb),
  ('streak_7', 'Consistency King', 'Maintain a 7-day active streak', 'flame-icon-7', 'social', 'rare', '{"type": "streak_days", "target": 7}'::jsonb, '{"type": "xp", "value": 350}'::jsonb),
  ('streak_30', 'Unstoppable Force', 'Maintain a 30-day active streak', 'flame-icon-30', 'legendary', '{"type": "streak_days", "target": 30}'::jsonb, '{"type": "xlm", "value": 25}'::jsonb),
  ('learning_path_completed', 'Path Finder', 'Complete an entire learning path', 'book-icon-1', 'learning', 'rare', '{"type": "learning_milestones", "target": 1}'::jsonb, '{"type": "discount", "value": 15}'::jsonb),
  ('5_star_review', 'Crowd Favorite', 'Receive a 5-star session review', 'star-icon-5', 'social', 'epic', '{"type": "review_rating", "target": 5}'::jsonb, '{"type": "xp", "value": 250}'::jsonb)
ON CONFLICT (id) DO NOTHING;
