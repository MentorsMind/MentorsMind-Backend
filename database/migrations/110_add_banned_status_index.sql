-- =============================================================================
-- Migration: 110_add_banned_status_index.sql
-- Description: Add index for banned users (separate from enum creation)
-- =============================================================================

-- Index for quickly finding banned users
-- This must be in a separate migration because PostgreSQL doesn't allow
-- using new ENUM values in the same transaction where they're created
CREATE INDEX IF NOT EXISTS idx_users_status_banned ON users(status) WHERE status = 'banned';