-- =============================================================================
-- Migration: 095_create_wallet_reconciliation_log.sql
-- Description: Audit log for wallet balance reconciliation between the
--              PostgreSQL wallet_balances table and the Stellar network (the
--              authoritative source of truth). One row is written per asset
--              whose on-chain balance differs from the stored balance.
--
--              Idempotency: a row is only inserted when a real discrepancy is
--              corrected (the stored balance is mutated inside the same
--              transaction that reads it via SELECT ... FOR UPDATE), so running
--              syncWallet twice for an already-synced wallet produces no new
--              log entries.
-- =============================================================================

CREATE TABLE IF NOT EXISTS wallet_reconciliation_log (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id          UUID        NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  reconciliation_run_id UUID      NOT NULL,
  asset_type         VARCHAR(20) NOT NULL,
  asset_code         VARCHAR(12),
  asset_issuer       VARCHAR(56),
  before_balance     DECIMAL(20, 7) NOT NULL DEFAULT 0,
  after_balance      DECIMAL(20, 7) NOT NULL DEFAULT 0,
  discrepancy        DECIMAL(20, 7) NOT NULL DEFAULT 0,
  discrepancy_xlm    DECIMAL(20, 7),
  alerted            BOOLEAN     NOT NULL DEFAULT FALSE,
  synced_at          TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_reconciliation_log_wallet_id
  ON wallet_reconciliation_log(wallet_id);

CREATE INDEX IF NOT EXISTS idx_wallet_reconciliation_log_run_id
  ON wallet_reconciliation_log(reconciliation_run_id);

CREATE INDEX IF NOT EXISTS idx_wallet_reconciliation_log_synced_at
  ON wallet_reconciliation_log(synced_at DESC);

CREATE INDEX IF NOT EXISTS idx_wallet_reconciliation_log_alerted
  ON wallet_reconciliation_log(alerted, synced_at DESC);
