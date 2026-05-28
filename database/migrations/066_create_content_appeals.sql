-- =============================================================================
-- Migration: 066_create_content_appeals.sql
-- Description: Create table for content moderation appeals
-- =============================================================================

CREATE TYPE appeal_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE IF NOT EXISTS content_appeals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_id UUID NOT NULL REFERENCES flags(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status appeal_status NOT NULL DEFAULT 'pending',
  admin_notes TEXT,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Ensure a user can only have one active appeal per flag
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_appeals_flag_unique 
  ON content_appeals(flag_id) 
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_content_appeals_status ON content_appeals(status);
CREATE INDEX IF NOT EXISTS idx_content_appeals_user ON content_appeals(user_id);

-- Add update trigger
CREATE TRIGGER update_content_appeals_updated_at
  BEFORE UPDATE ON content_appeals
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
