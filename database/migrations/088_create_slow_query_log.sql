-- =============================================================================
-- Migration: 088_create_slow_query_log.sql
-- Description: Persistent log of slow database queries for performance
--              monitoring and index recommendation (issue #742).
--              Stores normalised SQL fingerprints, execution times, and
--              EXPLAIN ANALYZE plans captured asynchronously.
-- =============================================================================

DROP TABLE IF EXISTS slow_query_log CASCADE;

CREATE TABLE slow_query_log (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  query_hash        TEXT        NOT NULL,
  normalized_query  TEXT        NOT NULL,
  execution_time_ms NUMERIC(12, 3) NOT NULL,
  plan_json         JSONB,
  occurred_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_slow_query_log_query_hash
  ON slow_query_log(query_hash);

CREATE INDEX IF NOT EXISTS idx_slow_query_log_occurred_at
  ON slow_query_log(occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_slow_query_log_execution_time
  ON slow_query_log(execution_time_ms DESC);
