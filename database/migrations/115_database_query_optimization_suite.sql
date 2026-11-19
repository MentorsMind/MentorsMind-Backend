-- =============================================================================
-- Migration: 115_database_query_optimization_suite.sql
-- Description: composite indexes and monitoring views for query optimization and slow-query analysis.
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_bookings_mentor_status_time
  ON bookings (mentor_id, status, scheduled_start);

CREATE INDEX IF NOT EXISTS idx_bookings_mentee_status_time
  ON bookings (mentee_id, status, scheduled_start);

CREATE INDEX IF NOT EXISTS idx_sessions_user_status_time
  ON sessions (mentor_id, status, scheduled_at_utc DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_mentee_status_time
  ON sessions (mentee_id, status, scheduled_at_utc DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_user_status_created
  ON transactions (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_disputes_status_created
  ON disputes (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_read_created
  ON notifications (user_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_type_created
  ON audit_logs (entity_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_active_expires
  ON refresh_tokens (user_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_slow_query_log_query_hash_occurred_at
  ON slow_query_log (query_hash, occurred_at DESC);

CREATE OR REPLACE VIEW v_query_optimization_summary AS
SELECT
  query_hash,
  normalized_query,
  COUNT(*) AS occurrences,
  ROUND(AVG(execution_time_ms)::numeric, 2) AS avg_execution_time_ms,
  ROUND(MAX(execution_time_ms)::numeric, 2) AS max_execution_time_ms,
  MAX(occurred_at) AS last_seen
FROM slow_query_log
GROUP BY query_hash, normalized_query
ORDER BY max_execution_time_ms DESC
LIMIT 50;

CREATE OR REPLACE VIEW v_slow_query_plan_summary AS
SELECT
  query_hash,
  COUNT(*) AS plan_count,
  ROUND(AVG(CAST(duration_ms AS numeric)), 2) AS avg_duration_ms,
  MAX(duration_ms) AS peak_duration_ms
FROM slow_query_log
WHERE query_plan IS NOT NULL
GROUP BY query_hash
ORDER BY peak_duration_ms DESC
LIMIT 50;
