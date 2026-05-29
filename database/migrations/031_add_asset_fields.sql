-- =============================================================================
-- Migration: 031_add_asset_fields.sql
-- Description: Add asset_code and asset_issuer to transactions; add quote_id
--              and slippage tracking for multi-asset path payments.
-- =============================================================================

-- Ensure asset_code / asset_issuer columns exist (they may already be present
-- from 003_create_transactions.sql — use IF NOT EXISTS guards).
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS asset_code   VARCHAR(12),
  ADD COLUMN IF NOT EXISTS asset_issuer VARCHAR(56),
  ADD COLUMN IF NOT EXISTS quote_id     UUID,
  ADD COLUMN IF NOT EXISTS quoted_rate  DECIMAL(30, 15),
  ADD COLUMN IF NOT EXISTS executed_rate DECIMAL(30, 15),
  ADD COLUMN IF NOT EXISTS path_payment  BOOLEAN NOT NULL DEFAULT FALSE;

-- Index for asset-based queries
CREATE INDEX IF NOT EXISTS idx_transactions_asset_code
  ON transactions(asset_code) WHERE asset_code IS NOT NULL;

COMMENT ON COLUMN transactions.asset_code    IS 'Asset code for non-native assets (e.g. USDC, PYUSD)';
COMMENT ON COLUMN transactions.asset_issuer  IS 'Stellar issuer public key for non-native assets';
COMMENT ON COLUMN transactions.quote_id      IS 'Reference to the payment quote used for this transaction';
COMMENT ON COLUMN transactions.quoted_rate   IS 'Exchange rate at quote time (from/to)';
COMMENT ON COLUMN transactions.executed_rate IS 'Actual exchange rate at execution time';
COMMENT ON COLUMN transactions.path_payment  IS 'True when Stellar path payment was used';
