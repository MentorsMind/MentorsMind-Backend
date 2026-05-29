-- Migration: Add collaboration state storage to sessions table
-- Created: 2026-05-28
-- Description: Adds JSON-backed collaboration state to session records for whiteboard and shared editor storage

DO $$
BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'sessions'
        AND column_name = 'collaboration_state'
    ) THEN
      ALTER TABLE sessions ADD COLUMN collaboration_state JSONB;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sessions_collaboration_state ON sessions USING gin (collaboration_state);

COMMENT ON COLUMN sessions.collaboration_state IS 'JSONB storage for recorded collaboration state, shared code, whiteboard state, and screen sharing metadata';
