DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname = 'transaction_status'
          AND e.enumlabel = 'confirmed'
    ) THEN
        ALTER TYPE transaction_status ADD VALUE 'confirmed';
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS stellar_operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stellar_operation_id VARCHAR(100) NOT NULL UNIQUE,
    transaction_hash VARCHAR(64) NOT NULL,
    ledger_sequence INTEGER,
    source_account VARCHAR(56),
    destination_account VARCHAR(56),
    amount DECIMAL(20, 7),
    asset_type VARCHAR(20),
    asset_code VARCHAR(20),
    operation_type VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stellar_operations_tx_hash
    ON stellar_operations(transaction_hash);
CREATE INDEX IF NOT EXISTS idx_stellar_operations_ledger_sequence
    ON stellar_operations(ledger_sequence);
CREATE INDEX IF NOT EXISTS idx_stellar_operations_destination_account
    ON stellar_operations(destination_account);
