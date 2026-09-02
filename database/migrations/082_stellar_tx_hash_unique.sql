-- =============================================================================
-- Migration: 082_stellar_tx_hash_unique.sql
-- Description: Add UNIQUE constraint on transactions.stellar_tx_hash to prevent replay attacks
-- =============================================================================

-- Add unique constraint to stellar_tx_hash if it doesn't already exist
DO $$
BEGIN
    -- Check if the constraint already exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.constraint_column_usage 
        WHERE table_name = 'transactions' 
        AND constraint_name = 'transactions_stellar_tx_hash_key'
    ) THEN
        ALTER TABLE transactions
        ADD CONSTRAINT transactions_stellar_tx_hash_key UNIQUE (stellar_tx_hash);
        
        RAISE NOTICE 'Added UNIQUE constraint transactions_stellar_tx_hash_key';
    ELSE
        RAISE NOTICE 'UNIQUE constraint transactions_stellar_tx_hash_key already exists, skipping';
    END IF;
END $$;

-- Add comment (this is idempotent)
COMMENT ON CONSTRAINT transactions_stellar_tx_hash_key ON transactions IS
  'Ensures a Stellar transaction hash can be used for at most one payment';
