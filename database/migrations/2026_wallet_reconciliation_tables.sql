/**
 * Database migration for wallet reconciliation tracking
 *
 * Creates tables to track:
 * 1. Wallet reconciliation logs (when/what was reconciled)
 * 2. Balance discrepancy history (audit trail of issues)
 * 3. Wallet notifications (balance update notifications)
 *
 * File: database/migrations/create_wallet_reconciliation_tables.sql
 */

-- Create wallet reconciliation logs table
CREATE TABLE IF NOT EXISTS wallet_reconciliation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  discrepancies_found INT DEFAULT 0,
  corrected_count INT DEFAULT 0,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  -- pending | completed | failed
  error_message TEXT,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT unique_user_latest_reconciliation 
    UNIQUE (user_id, completed_at) 
    WHERE status = 'completed'
);

-- Index for finding pending reconciliations
CREATE INDEX IF NOT EXISTS idx_wallet_recon_pending 
ON wallet_reconciliation_logs(user_id, created_at DESC) 
WHERE status = 'pending';

-- Index for finding old reconciliations that need updating
CREATE INDEX IF NOT EXISTS idx_wallet_recon_completed 
ON wallet_reconciliation_logs(completed_at DESC) 
WHERE status = 'completed';

-- Create balance discrepancy audit trail
CREATE TABLE IF NOT EXISTS wallet_balance_discrepancies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_log_id UUID REFERENCES wallet_reconciliation_logs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_code VARCHAR(50) NOT NULL,
  asset_issuer VARCHAR(255),
  postgres_balance DECIMAL(20, 7) NOT NULL,
  stellar_balance DECIMAL(20, 7) NOT NULL,
  discrepancy_amount DECIMAL(20, 7) NOT NULL,
  discrepancy_reason VARCHAR(100) NOT NULL,
  -- direct_payment | missed_event | external_transaction | unknown
  was_corrected BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for querying discrepancies by user
CREATE INDEX IF NOT EXISTS idx_balance_discrepancies_user 
ON wallet_balance_discrepancies(user_id, created_at DESC);

-- Index for querying discrepancies by asset
CREATE INDEX IF NOT EXISTS idx_balance_discrepancies_asset 
ON wallet_balance_discrepancies(asset_code, asset_issuer);

-- Create wallet notifications table
CREATE TABLE IF NOT EXISTS wallet_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_type VARCHAR(100) NOT NULL,
  -- balance_corrected | balance_warning | low_balance | high_activity
  data JSONB,
  read_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for unread notifications
CREATE INDEX IF NOT EXISTS idx_wallet_notifications_unread 
ON wallet_notifications(user_id, created_at DESC) 
WHERE read_at IS NULL;

-- Add columns to wallet_balances if not already present
ALTER TABLE wallet_balances ADD COLUMN IF NOT EXISTS 
last_reconciled_at TIMESTAMP WITH TIME ZONE;

-- Add index for tracking stale balances
CREATE INDEX IF NOT EXISTS idx_wallet_balances_stale 
ON wallet_balances(last_reconciled_at) 
WHERE last_reconciled_at < CURRENT_TIMESTAMP - INTERVAL '24 hours';

-- Create view for wallet reconciliation summary
CREATE OR REPLACE VIEW wallet_reconciliation_summary AS
SELECT 
  w.user_id,
  w.stellar_public_key,
  w.status as wallet_status,
  COUNT(DISTINCT wrl.id) as total_reconciliations,
  SUM(CASE WHEN wrl.status = 'completed' THEN 1 ELSE 0 END) as successful_reconciliations,
  SUM(CASE WHEN wrl.status = 'failed' THEN 1 ELSE 0 END) as failed_reconciliations,
  SUM(COALESCE(wrl.discrepancies_found, 0)) as total_discrepancies_found,
  SUM(COALESCE(wrl.corrected_count, 0)) as total_corrected,
  MAX(wrl.completed_at) as last_reconciliation,
  CASE 
    WHEN MAX(wrl.completed_at) IS NULL THEN 'never'
    WHEN MAX(wrl.completed_at) < NOW() - INTERVAL '7 days' THEN 'overdue'
    WHEN MAX(wrl.completed_at) < NOW() - INTERVAL '1 day' THEN 'needs_check'
    ELSE 'recent'
  END as reconciliation_status
FROM wallets w
LEFT JOIN wallet_reconciliation_logs wrl ON w.user_id = wrl.user_id
GROUP BY w.user_id, w.stellar_public_key, w.status;
