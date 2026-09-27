-- Add zero-downtime indexes used by push delivery and stale-token cleanup.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_push_tokens_user_id
  ON push_tokens(user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_push_tokens_last_used
  ON push_tokens(last_used_at);
