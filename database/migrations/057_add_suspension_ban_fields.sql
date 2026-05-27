-- =============================================================================
-- Migration: 057_add_suspension_ban_fields.sql
-- Description: Add proper suspension and permanent ban support to users table
-- =============================================================================

-- Add 'banned' to the user_status ENUM
ALTER TYPE user_status ADD VALUE IF NOT EXISTS 'banned';

-- Add suspension/ban tracking columns
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS suspension_reason    TEXT,
  ADD COLUMN IF NOT EXISTS suspension_expires_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS suspended_at          TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS suspended_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ban_reason            TEXT,
  ADD COLUMN IF NOT EXISTS banned_at             TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS banned_by             UUID REFERENCES users(id) ON DELETE SET NULL;

-- Index for quickly finding suspended/banned users
CREATE INDEX IF NOT EXISTS idx_users_status_suspended ON users(status) WHERE status = 'suspended';
CREATE INDEX IF NOT EXISTS idx_users_status_banned    ON users(status) WHERE status = 'banned';

COMMENT ON COLUMN users.suspension_reason     IS 'Admin-provided reason for the suspension';
COMMENT ON COLUMN users.suspension_expires_at IS 'When the suspension ends (NULL = indefinite)';
COMMENT ON COLUMN users.suspended_at          IS 'Timestamp when the user was suspended';
COMMENT ON COLUMN users.suspended_by          IS 'Admin user ID who issued the suspension';
COMMENT ON COLUMN users.ban_reason            IS 'Admin-provided reason for the permanent ban';
COMMENT ON COLUMN users.banned_at             IS 'Timestamp when the user was permanently banned';
COMMENT ON COLUMN users.banned_by             IS 'Admin user ID who issued the ban';
