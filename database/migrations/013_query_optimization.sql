-- =============================================================================
-- Migration: 013_query_optimization.sql
-- Description: Query optimization — missing indexes, slow query logging,
--              and pg_stat_statements setup for top-N analysis.
-- =============================================================================

-- ============================================================================
-- 1. Slow Query Log Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS slow_query_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  query_text TEXT NOT NULL,
  duration_ms NUMERIC(12, 2) NOT NULL,
  rows_returned INTEGER,
  caller TEXT,                       -- e.g. model/service name
  query_plan JSONB,                  -- EXPLAIN ANALYZE output
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_slow_query_log_duration
  ON slow_query_log(duration_ms DESC);

CREATE INDEX IF NOT EXISTS idx_slow_query_log_created_at
  ON slow_query_log(created_at DESC);

-- Auto-purge entries older than 30 days (run via scheduled job)
-- DELETE FROM slow_query_log WHERE created_at < NOW() - INTERVAL '30 days';

-- ============================================================================
-- 2. Notifications — composite indexes for hot query paths
-- ============================================================================

-- getByUserId + getUnreadByUserId: WHERE user_id = $1 AND is_read = false ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications(user_id, created_at DESC)
  WHERE is_read = FALSE;

-- getScheduledNotifications: WHERE scheduled_at <= NOW() ORDER BY priority DESC, scheduled_at ASC
CREATE INDEX IF NOT EXISTS idx_notifications_scheduled_pending
  ON notifications(scheduled_at ASC, priority DESC)
  WHERE scheduled_at IS NOT NULL;

-- getCountsByUserId: COUNT with CASE on is_read for a given user
CREATE INDEX IF NOT EXISTS idx_notifications_user_read_status
  ON notifications(user_id, is_read);

-- ============================================================================
-- 3. Payments — missing user_id index
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_payments_user_id
  ON payments(user_id);

CREATE INDEX IF NOT EXISTS idx_payments_user_created
  ON payments(user_id, created_at DESC);

-- ============================================================================
-- 4. Sessions — OR-clause optimization
--    Queries use (mentor_id = $1 OR mentee_id = $1) which cannot use a
--    single B-tree efficiently. Add individual covering indexes so the
--    planner can UNION two index scans.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_sessions_mentor_scheduled
  ON sessions(mentor_id, scheduled_at DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_mentee_scheduled
  ON sessions(mentee_id, scheduled_at DESC);

-- Upcoming sessions partial index (used by findUpcomingByUserId)
CREATE INDEX IF NOT EXISTS idx_sessions_upcoming_mentor
  ON sessions(mentor_id, scheduled_at ASC)
  WHERE status IN ('pending', 'confirmed');

CREATE INDEX IF NOT EXISTS idx_sessions_upcoming_mentee
  ON sessions(mentee_id, scheduled_at ASC)
  WHERE status IN ('pending', 'confirmed');

-- Expired meetings lookup
CREATE INDEX IF NOT EXISTS idx_sessions_expired_meetings
  ON sessions(meeting_expires_at ASC)
  WHERE meeting_expires_at IS NOT NULL
    AND status IN ('confirmed', 'completed');

-- Manual intervention partial index
CREATE INDEX IF NOT EXISTS idx_sessions_manual_intervention
  ON sessions(created_at DESC)
  WHERE needs_manual_intervention = TRUE;

-- ============================================================================
-- 5. Escrows — OR-clause optimization (same pattern as sessions)
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_escrows_learner_created
  ON escrows(learner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_escrows_mentor_created
  ON escrows(mentor_id, created_at DESC);

-- ============================================================================
-- 6. Bookings — conflict-check optimization
--    checkConflict filters: mentor_id, status NOT IN (cancelled, completed),
--    and overlapping time range.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_bookings_conflict_check
  ON bookings(mentor_id, scheduled_at)
  WHERE status NOT IN ('cancelled', 'completed');

-- ============================================================================
-- 7. Disputes — sorted reporter queries
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_disputes_reporter_created
  ON disputes(reporter_id, created_at DESC);

-- Unresolved disputes older than N days
CREATE INDEX IF NOT EXISTS idx_disputes_unresolved_age
  ON disputes(created_at ASC)
  WHERE status != 'resolved';

-- ============================================================================
-- 8. Enable pg_stat_statements (if available)
--    This extension tracks execution statistics for all queries.
--    Run as superuser: CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
--    Then query: SELECT * FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;
-- ============================================================================

-- Uncomment the line below if you have superuser access:
-- CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- ============================================================================
-- 9. Query analysis view — top slow queries (requires pg_stat_statements)
-- ============================================================================

-- This view is safe to create even if pg_stat_statements is not installed;
-- it will simply error on SELECT if the extension is missing.
CREATE OR REPLACE VIEW v_top_slow_queries AS
SELECT
  queryid,
  LEFT(query, 200) AS query_preview,
  calls,
  ROUND(total_exec_time::numeric, 2) AS total_ms,
  ROUND(mean_exec_time::numeric, 2) AS avg_ms,
  ROUND(max_exec_time::numeric, 2) AS max_ms,
  rows AS total_rows
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 20;

-- ============================================================================
-- 10. Application-level slow query analysis view
-- ============================================================================

CREATE OR REPLACE VIEW v_slow_query_summary AS
SELECT
  LEFT(query_text, 120) AS query_preview,
  COUNT(*) AS occurrences,
  ROUND(AVG(duration_ms)::numeric, 2) AS avg_ms,
  ROUND(MAX(duration_ms)::numeric, 2) AS max_ms,
  ROUND(MIN(duration_ms)::numeric, 2) AS min_ms,
  MAX(created_at) AS last_seen
FROM slow_query_log
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY LEFT(query_text, 120)
ORDER BY avg_ms DESC
LIMIT 20;
