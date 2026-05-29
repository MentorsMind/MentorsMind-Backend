-- #392: Add composite index to support unread-first notification listing
-- ORDER BY is_read ASC, created_at DESC WHERE user_id = $1
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_unread_first
  ON notifications (user_id, is_read, created_at DESC)
  WHERE dismissed_at IS NULL;
