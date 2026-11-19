-- =============================================================================
-- Migration: 094_create_search_analytics.sql
-- Description: Captures every NLP/keyword search event for analytics:
--              the raw query, its normalized form, the structured filters
--              extracted by NlpSearchService.parseQuery, the number of results
--              returned (including zero-result queries), and the requesting user.
--              Powers search relevance analysis and typo/fallback monitoring.
-- =============================================================================

CREATE TABLE IF NOT EXISTS search_analytics (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID,
  query             TEXT        NOT NULL,
  normalized_query  TEXT,
  extracted_filters JSONB       NOT NULL DEFAULT '{}'::jsonb,
  result_count      INTEGER     NOT NULL DEFAULT 0,
  has_results       BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_search_analytics_created_at
  ON search_analytics(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_search_analytics_query
  ON search_analytics(query);

CREATE INDEX IF NOT EXISTS idx_search_analytics_user_id
  ON search_analytics(user_id);

CREATE INDEX IF NOT EXISTS idx_search_analytics_has_results
  ON search_analytics(has_results, created_at DESC);
