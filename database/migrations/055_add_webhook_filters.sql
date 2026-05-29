-- =============================================================================
-- Migration: 055_add_webhook_filters.sql
-- Description: Add event subscription filters (resource_types, statuses) to
--              webhooks table and expand supported event types.
--
-- New columns:
--   resource_types  TEXT[]  — optional filter by resource type (e.g. 'booking', 'payment')
--   filter_statuses TEXT[]  — optional filter by resource status (e.g. 'confirmed', 'failed')
-- =============================================================================

ALTER TABLE webhooks
  ADD COLUMN IF NOT EXISTS resource_types  TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS filter_statuses TEXT[] NOT NULL DEFAULT '{}';

-- GIN indexes for fast array containment queries
CREATE INDEX IF NOT EXISTS idx_webhooks_resource_types
  ON webhooks USING GIN(resource_types);

CREATE INDEX IF NOT EXISTS idx_webhooks_filter_statuses
  ON webhooks USING GIN(filter_statuses);

COMMENT ON COLUMN webhooks.resource_types IS
  'Optional filter: only deliver events whose resource type is in this list. Empty = all resources.';

COMMENT ON COLUMN webhooks.filter_statuses IS
  'Optional filter: only deliver events whose resource status is in this list. Empty = all statuses.';
