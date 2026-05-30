-- Migration: 075_mentor_onboarding_enhancements
-- Enhances mentor onboarding with wizard, scoring, verification, analytics

-- Profile completeness scoring table
CREATE TABLE IF NOT EXISTS mentor_profile_scores (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id         UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  total_score       NUMERIC(5, 2) NOT NULL DEFAULT 0,    -- 0.00 - 100.00
  bio_score         NUMERIC(5, 2) DEFAULT 0,
  expertise_score   NUMERIC(5, 2) DEFAULT 0,
  photo_score       NUMERIC(5, 2) DEFAULT 0,
  education_score   NUMERIC(5, 2) DEFAULT 0,
  certification_score NUMERIC(5, 2) DEFAULT 0,
  availability_score NUMERIC(5, 2) DEFAULT 0,
  pricing_score     NUMERIC(5, 2) DEFAULT 0,
  sections_completed TEXT[] DEFAULT '{}',
  missing_sections   TEXT[] DEFAULT '{}',
  suggestions        JSONB DEFAULT '[]',                  -- [{section, suggestion, impact}]
  computed_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Onboarding wizard steps configuration
CREATE TABLE IF NOT EXISTS onboarding_wizard_steps (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  step_key          TEXT NOT NULL UNIQUE,
  title             TEXT NOT NULL,
  description       TEXT,
  category          TEXT NOT NULL,                        -- 'profile', 'verification', 'training', 'setup'
  step_order        INTEGER NOT NULL,
  is_required       BOOLEAN NOT NULL DEFAULT true,
  estimated_minutes INTEGER,
  depends_on        TEXT[] DEFAULT '[]',                  -- step keys that must be completed first
  metadata          JSONB DEFAULT '{}',
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Onboarding email sequences
CREATE TABLE IF NOT EXISTS onboarding_email_sequences (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_step      TEXT NOT NULL,                        -- step_key that triggers this email
  subject           TEXT NOT NULL,
  template_name     TEXT NOT NULL,
  delay_minutes     INTEGER NOT NULL DEFAULT 0,           -- delay after step completion
  metadata          JSONB DEFAULT '{}',
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Mentor success checklist items
CREATE TABLE IF NOT EXISTS mentor_success_checklist (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_key          TEXT NOT NULL,
  title             TEXT NOT NULL,
  description       TEXT,
  category          TEXT NOT NULL,                        -- 'profile', 'session', 'earning', 'growth'
  is_completed      BOOLEAN NOT NULL DEFAULT false,
  completed_at      TIMESTAMP WITH TIME ZONE,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(mentor_id, item_key)
);

-- Onboarding analytics
CREATE TABLE IF NOT EXISTS onboarding_analytics (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type        TEXT NOT NULL,                        -- 'step_view', 'step_complete', 'wizard_start', 'wizard_complete', 'email_sent', 'email_opened'
  step_key          TEXT,
  metadata          JSONB DEFAULT '{}',
  occurred_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Default onboarding wizard steps
INSERT INTO onboarding_wizard_steps (step_key, title, description, category, step_order, is_required, estimated_minutes, depends_on) VALUES
  ('profile_basics', 'Basic Profile', 'Add your name, bio, and profile photo', 'profile', 1, true, 10, '[]'),
  ('expertise', 'Define Expertise', 'Select your skills and areas of expertise', 'profile', 2, true, 15, '{profile_basics}'),
  ('education', 'Education & Credentials', 'Add your educational background', 'profile', 3, false, 10, '{expertise}'),
  ('identity_verification', 'Identity Verification', 'Upload government-issued ID for verification', 'verification', 4, true, 20, '{expertise}'),
  ('background_check', 'Background Check', 'Complete background screening process', 'verification', 5, true, 5, '{identity_verification}'),
  ('skill_assessment', 'Skill Assessment', 'Pass skill evaluation tests for your expertise areas', 'verification', 6, true, 45, '{background_check}'),
  ('platform_orientation', 'Platform Training', 'Learn how to use MentorsMind platform features', 'training', 7, true, 30, '{skill_assessment}'),
  ('pricing_setup', 'Set Your Rates', 'Configure session pricing and availability', 'setup', 8, true, 15, '{platform_orientation}'),
  ('schedule_setup', 'Set Your Schedule', 'Define your availability and booking preferences', 'setup', 9, true, 10, '{pricing_setup}'),
  ('payment_setup', 'Payment Setup', 'Connect your Stellar wallet for payouts', 'setup', 10, true, 10, '{schedule_setup}'),
  ('policies_agreement', 'Accept Policies', 'Review and accept platform terms and policies', 'setup', 11, true, 5, '{payment_setup}'),
  ('practice_session', 'Practice Session', 'Complete a practice mentoring session', 'training', 12, true, 60, '{policies_agreement}'),
  ('profile_review', 'Profile Review', 'Submit for admin review and approval', 'verification', 13, true, 5, '{practice_session}');

-- Default onboarding email sequences
INSERT INTO onboarding_email_sequences (trigger_step, subject, template_name, delay_minutes) VALUES
  ('profile_basics', 'Welcome to MentorsMind — Let''s Get Started!', 'onboarding-welcome', 0),
  ('expertise', 'Tell Us About Your Expertise', 'onboarding-expertise', 1440),
  ('identity_verification', 'Verify Your Identity to Start Mentoring', 'onboarding-verify-identity', 0),
  ('skill_assessment', 'Complete Your Skill Assessment', 'onboarding-skill-assessment', 1440),
  ('pricing_setup', 'Set Your Rates and Start Earning', 'onboarding-pricing', 0),
  ('profile_review', 'Your Profile Is Under Review', 'onboarding-under-review', 0),
  ('profile_review', 'Congratulations! You''re Now a Mentor', 'onboarding-approved', 0);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_mentor_profile_scores_mentor ON mentor_profile_scores(mentor_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_wizard_steps_order ON onboarding_wizard_steps(step_order);
CREATE INDEX IF NOT EXISTS idx_onboarding_email_seq_trigger ON onboarding_email_sequences(trigger_step);
CREATE INDEX IF NOT EXISTS idx_mentor_success_checklist_mentor ON mentor_success_checklist(mentor_id);
CREATE INDEX IF NOT EXISTS idx_mentor_success_checklist_completed ON mentor_success_checklist(mentor_id, is_completed);
CREATE INDEX IF NOT EXISTS idx_onboarding_analytics_mentor ON onboarding_analytics(mentor_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_analytics_event ON onboarding_analytics(event_type);
CREATE INDEX IF NOT EXISTS idx_onboarding_analytics_occurred ON onboarding_analytics(occurred_at);

-- Auto-update triggers
CREATE OR REPLACE FUNCTION update_profile_scores_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mentor_profile_scores_updated_at ON mentor_profile_scores;
CREATE TRIGGER trg_mentor_profile_scores_updated_at
  BEFORE UPDATE ON mentor_profile_scores
  FOR EACH ROW EXECUTE FUNCTION update_profile_scores_updated_at();

DROP TRIGGER IF EXISTS trg_mentor_success_checklist_updated_at ON mentor_success_checklist;
CREATE TRIGGER trg_mentor_success_checklist_updated_at
  BEFORE UPDATE ON mentor_success_checklist
  FOR EACH ROW EXECUTE FUNCTION update_profile_scores_updated_at();
