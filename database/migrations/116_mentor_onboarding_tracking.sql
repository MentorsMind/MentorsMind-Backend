-- =============================================================================
-- Migration: 116_mentor_onboarding_tracking.sql
-- Description: Named onboarding step tracking, nudge email sequence state,
--              completion badge issuance, and admin funnel analytics.
-- =============================================================================

-- Extend mentor_onboarding with a named step breakdown plus nudge email state.
-- The five canonical steps referenced throughout the feature are:
--   profile, availability, rates, verification, first_session
ALTER TABLE mentor_onboarding
  ADD COLUMN IF NOT EXISTS step_profile         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS step_availability    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS step_rates           BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS step_verification    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS step_first_session   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS nudge_24h_sent       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS nudge_72h_sent       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS nudge_7d_sent        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_nudge_sent_at   TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS badge_issued_at      TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_mentor_onboarding_status_created
  ON mentor_onboarding (status, created_at);

CREATE INDEX IF NOT EXISTS idx_mentor_onboarding_incomplete
  ON mentor_onboarding (status)
  WHERE status = 'in_progress';

-- Badge issuance ledger. One row per completed mentor onboarding badge.
CREATE TABLE IF NOT EXISTS mentor_badges (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_type    TEXT NOT NULL,                -- 'mentor_onboarding_complete'
  title         TEXT NOT NULL,
  description   TEXT,
  icon          TEXT,
  color         TEXT,
  issued_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (mentor_id, badge_type)
);

CREATE INDEX IF NOT EXISTS idx_mentor_badges_mentor ON mentor_badges (mentor_id);
CREATE INDEX IF NOT EXISTS idx_mentor_badges_type ON mentor_badges (badge_type);
