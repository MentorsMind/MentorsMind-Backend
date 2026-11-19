-- =============================================================================
-- Migration: 092_realtime_analytics_indexes.sql
-- Description: Adds covering indexes on base tables to support fast time-window
--              queries used by the real-time analytics pipeline (issue #749).
--              These queries bypass materialized views and scan transactions,
--              bookings, and users directly with a WHERE created_at > NOW() - interval.
-- =============================================================================

-- ── transactions ─────────────────────────────────────────────────────────────
-- Supports: SELECT amount, status, currency FROM transactions WHERE created_at > $1
CREATE INDEX IF NOT EXISTS idx_transactions_created_status
  ON transactions (created_at DESC, status);

-- ── bookings ─────────────────────────────────────────────────────────────────
-- Supports: SELECT status, mentor_id, mentee_id FROM bookings WHERE created_at > $1
CREATE INDEX IF NOT EXISTS idx_bookings_created_status
  ON bookings (created_at DESC, status);

-- ── users ────────────────────────────────────────────────────────────────────
-- Supports: SELECT role, COUNT(*) FROM users WHERE created_at > $1 GROUP BY role
CREATE INDEX IF NOT EXISTS idx_users_created_role
  ON users (created_at DESC, role)
  WHERE deleted_at IS NULL;

-- ── reviews ──────────────────────────────────────────────────────────────────
-- Supports: top-mentor queries joining on mentor_id + created_at window
CREATE INDEX IF NOT EXISTS idx_reviews_mentor_created
  ON reviews (mentor_id, created_at DESC);
