-- =============================================================================
-- Migration: 003_create_transactions.sql
-- Description: Create transactions table with Stellar integration
-- =============================================================================

-- Create ENUM types for transactions
CREATE TYPE transaction_type AS ENUM (
    'deposit',
    'withdrawal', 
    'payment',
    'refund',
    'platform_fee',
    'mentor_payout',
    'escrow_hold',
    'escrow_release'
);

CREATE TYPE transaction_status AS ENUM (
    'pending',
    'processing',
    'completed',
    'failed',
    'cancelled',
    'refunded'
);

-- Create transactions table
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- User and wallet relationships
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    wallet_id UUID REFERENCES wallets(id) ON DELETE RESTRICT,
    
    -- Transaction details
    type transaction_type NOT NULL,
    status transaction_status NOT NULL DEFAULT 'pending',
    
    -- Amount and currency
    amount DECIMAL(20, 7) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'XLM',
    
    -- Asset details (for non-native assets)
    asset_type VARCHAR(20) DEFAULT 'native',
    asset_code VARCHAR(12),
    asset_issuer VARCHAR(56),
    
    -- Stellar blockchain integration
    stellar_tx_hash VARCHAR(64) UNIQUE,
    stellar_ledger_sequence INTEGER,
    stellar_operation_id VARCHAR(100),
    stellar_memo TEXT,
    stellar_memo_type VARCHAR(20),
    
    -- Transaction parties
    from_address VARCHAR(56),
    to_address VARCHAR(56),
    
    -- Related entities
    booking_id UUID, -- References bookings table (created later)
    related_transaction_id UUID REFERENCES transactions(id), -- For refunds, etc.
    
    -- Fees
    platform_fee DECIMAL(20, 7) DEFAULT 0,
    network_fee DECIMAL(20, 7) DEFAULT 0,
    total_fee DECIMAL(20, 7) GENERATED ALWAYS AS (platform_fee + network_fee) STORED,
    
    -- Status tracking
    initiated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    processed_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    failed_at TIMESTAMP WITH TIME ZONE,
    
    -- Error handling
    error_code VARCHAR(50),
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    
    -- Metadata
    description TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create transaction_events table for audit trail
CREATE TABLE IF NOT EXISTS transaction_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Transaction relationship
    transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    
    -- Event details
    event_type VARCHAR(50) NOT NULL, -- status_change, retry, error, etc.
    old_status transaction_status,
    new_status transaction_status,
    
    -- Event data
    description TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    
    -- Actor
    triggered_by UUID REFERENCES users(id),
    
    -- Timestamp
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for transactions
CREATE INDEX idx_transactions_user_id ON transactions(user_id);
CREATE INDEX idx_transactions_wallet_id ON transactions(wallet_id);
CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_transactions_type ON transactions(type);
CREATE INDEX idx_transactions_stellar_tx_hash ON transactions(stellar_tx_hash) WHERE stellar_tx_hash IS NOT NULL;
CREATE INDEX idx_transactions_stellar_ledger ON transactions(stellar_ledger_sequence) WHERE stellar_ledger_sequence IS NOT NULL;
CREATE INDEX idx_transactions_booking_id ON transactions(booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX idx_transactions_created_at ON transactions(created_at);
CREATE INDEX idx_transactions_completed_at ON transactions(completed_at) WHERE completed_at IS NOT NULL;
CREATE INDEX idx_transactions_from_to ON transactions(from_address, to_address);
CREATE INDEX idx_transactions_currency ON transactions(currency);

-- Create indexes for transaction_events
CREATE INDEX idx_transaction_events_transaction_id ON transaction_events(transaction_id);
CREATE INDEX idx_transaction_events_created_at ON transaction_events(created_at);
CREATE INDEX idx_transaction_events_event_type ON transaction_events(event_type);

-- Add constraints
ALTER TABLE transactions ADD CONSTRAINT check_amount_positive CHECK (amount > 0);
ALTER TABLE transactions ADD CONSTRAINT check_fees_non_negative CHECK (platform_fee >= 0 AND network_fee >= 0);
ALTER TABLE transactions ADD CONSTRAINT check_stellar_addresses CHECK (
    (from_address IS NULL OR from_address ~ '^G[A-Z2-7]{55}$') AND
    (to_address IS NULL OR to_address ~ '^G[A-Z2-7]{55}$')
);

-- Add comments
COMMENT ON TABLE transactions IS 'All financial transactions with Stellar blockchain integration';
COMMENT ON TABLE transaction_events IS 'Audit trail of transaction status changes and events';
COMMENT ON COLUMN transactions.stellar_tx_hash IS 'Stellar blockchain transaction hash for verification';
COMMENT ON COLUMN transactions.stellar_ledger_sequence IS 'Stellar ledger sequence number where transaction was recorded';
COMMENT ON COLUMN transactions.total_fee IS 'Computed column: sum of platform_fee and network_fee';
