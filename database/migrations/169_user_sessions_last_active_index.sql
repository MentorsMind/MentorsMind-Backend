-- Compound index to accelerate pool_updateLastActive in auth.middleware.ts.
--
-- The query filters on (user_id, revoked_at IS NULL, expires_at > NOW()) and
-- updates last_active_at on every authenticated request. Without a covering
-- index Postgres does a sequential scan or index-scan + filter, turning a
-- hot-path auth middleware call into an O(sessions) table scan per request.
--
-- The partial index (`WHERE revoked_at IS NULL`) keeps it small — only the live
-- sessions rows that the query actually touches are indexed.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_sessions_active_last_active
  ON user_sessions (user_id, expires_at, last_active_at)
  WHERE revoked_at IS NULL;
