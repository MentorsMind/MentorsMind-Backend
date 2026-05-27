-- Migration: 043_create_recommendation_events
-- Tracks recommendation impressions and click-through events for CTR analysis

CREATE TABLE IF NOT EXISTS recommendation_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mentor_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type    VARCHAR(20) NOT NULL CHECK (event_type IN ('impression', 'click')),
  algorithm     VARCHAR(50) NOT NULL DEFAULT 'collaborative_filtering',
  score         NUMERIC(5, 4),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rec_events_learner   ON recommendation_events(learner_id);
CREATE INDEX idx_rec_events_mentor    ON recommendation_events(mentor_id);
CREATE INDEX idx_rec_events_type_time ON recommendation_events(event_type, created_at);
