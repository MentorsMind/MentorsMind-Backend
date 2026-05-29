-- Add 'public' as a valid provider for integration_api_keys
-- and add rate_limit column for per-key rate limiting
ALTER TABLE integration_api_keys
  ADD COLUMN IF NOT EXISTS rate_limit INTEGER NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS description TEXT;

-- Allow 'public' provider value (drop and recreate constraint if needed)
DO $$
BEGIN
  -- No CHECK constraint on provider in the original migration, so just ensure index
  NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_integration_api_keys_owner_provider
  ON integration_api_keys(owner_user_id, provider);
