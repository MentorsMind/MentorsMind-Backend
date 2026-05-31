-- =============================================================================
-- Migration: 076_create_feature_flags.sql
-- Description: Feature flag system with A/B testing and experiment tracking
-- =============================================================================

CREATE TABLE IF NOT EXISTS feature_flags (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key                  VARCHAR(255) NOT NULL UNIQUE,
  name                 VARCHAR(255) NOT NULL,
  description          TEXT,
  enabled              BOOLEAN NOT NULL DEFAULT false,
  rollout_percentage   NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (rollout_percentage >= 0 AND rollout_percentage <= 100),
  targeting            JSONB NOT NULL DEFAULT '{}',
  -- targeting shape: { userIds?: string[], userSegments?: string[], tenants?: string[] }
  variants             JSONB NOT NULL DEFAULT '[]',
  -- variants shape: [{ name: string, weight: number, config: object }]
  created_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS experiment_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_key     VARCHAR(255) NOT NULL,
  user_id      VARCHAR(255),           -- nullable for anonymous users
  variant      VARCHAR(255),           -- null means flag was simply on/off
  event_type   VARCHAR(50) NOT NULL,   -- 'exposure' | 'conversion' | 'custom'
  metadata     JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_feature_flags_key     ON feature_flags(key);
CREATE INDEX idx_feature_flags_enabled ON feature_flags(enabled);

CREATE INDEX idx_experiment_events_flag_key   ON experiment_events(flag_key);
CREATE INDEX idx_experiment_events_user_id    ON experiment_events(user_id);
CREATE INDEX idx_experiment_events_created_at ON experiment_events(created_at);
CREATE INDEX idx_experiment_events_flag_variant ON experiment_events(flag_key, variant);

COMMENT ON TABLE feature_flags IS 'Feature flags with percentage rollout, user targeting, and A/B variants';
COMMENT ON TABLE experiment_events IS 'Experiment exposure and conversion events for A/B testing metrics';
