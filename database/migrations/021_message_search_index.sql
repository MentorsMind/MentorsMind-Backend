-- Migration: 021_message_search_index.sql
-- Description: Ensure GIN full-text search index on messages.body

-- GIN index for PostgreSQL full-text search (created in 019 if that ran first)
CREATE INDEX IF NOT EXISTS idx_messages_body_fts
    ON messages USING GIN(to_tsvector('english', body));

COMMENT ON INDEX idx_messages_body_fts IS 'GIN index for full-text search on message body';
