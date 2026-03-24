-- =============================================================================
-- Migration: 002_create_wallets.sql
-- Description: Create wallets table with multi-asset Stellar support
-- =============================================================================

-- Create ENUM for wallet status
CREATE TYPE wallet_status AS ENUM ('active', 'frozen', 'closed');

-- Create wallets table
CREATE TABLE IF NOT EXISTS wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- User relationship
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Stellar Integration
    stellar_public_key VARCHAR(56) NOT NULL UNIQUE,
    stellar_account_id VARCHAR(56) NOT NULL, -- Same as public key, for clarity
    
    -- Wallet Information
    wallet_type VARCHAR(20) NOT NULL DEFAULT 'user', -- user, platform, escrow
    status wallet_status NOT NULL DEFAULT 'active',
    
    -- Balance tracking (cached from Stellar)
    native_balance DECIMAL(20, 7) DEFAULT 0, -- XLM balance
    last_balance_update TIMESTAMP WITH TIME ZONE,
    
    -- Stellar Account Details
    sequence_number BIGINT, -- Stellar account sequence
    subentry_count INTEGER DEFAULT 0,
    last_modified_ledger INTEGER,
    
    -- Trust lines and assets
    trusted_assets JSONB DEFAULT '[]'::jsonb, -- Array of trusted asset objects
    
    -- Security
    requires_memo BOOLEAN DEFAULT FALSE,
    memo_type VARCHAR(20), -- text, id, hash
    
    -- Metadata
    metadata JSONB DEFAULT '{}'::jsonb,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Create wallet_balances table for multi-asset support
CREATE TABLE IF NOT EXISTS wallet_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Wallet relationship
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    
    -- Asset Information
    asset_type VARCHAR(20) NOT NULL, -- native, credit_alphanum4, credit_alphanum12
    asset_code VARCHAR(12), -- NULL for native XLM
    asset_issuer VARCHAR(56), -- NULL for native XLM
    
    -- Balance
    balance DECIMAL(20, 7) NOT NULL DEFAULT 0,
    limit DECIMAL(20, 7), -- Trust line limit
    
    -- Flags
    is_authorized BOOLEAN DEFAULT TRUE,
    is_authorized_to_maintain_liabilities BOOLEAN DEFAULT FALSE,
    is_clawback_enabled BOOLEAN DEFAULT FALSE,
    
    -- Metadata
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Unique constraint: one balance record per wallet per asset
    UNIQUE(wallet_id, asset_type, asset_code, asset_issuer)
);

-- Create wallet_transactions table for transaction history
CREATE TABLE IF NOT EXISTS wallet_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Wallet relationship
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    
    -- Transaction details
    stellar_tx_hash VARCHAR(64) NOT NULL,
    stellar_ledger INTEGER NOT NULL,
    operation_type VARCHAR(50) NOT NULL, -- payment, create_account, path_payment, etc.
    
    -- Amount and asset
    amount DECIMAL(20, 7),
    asset_type VARCHAR(20),
    asset_code VARCHAR(12),
    asset_issuer VARCHAR(56),
    
    -- Counterparty
    from_address VARCHAR(56),
    to_address VARCHAR(56),
    
    -- Status
    successful BOOLEAN NOT NULL,
    
    -- Metadata
    memo TEXT,
    memo_type VARCHAR(20),
    metadata JSONB DEFAULT '{}'::jsonb,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Unique constraint to prevent duplicate transaction records
    UNIQUE(stellar_tx_hash, wallet_id)
);

-- Create indexes for wallets
CREATE INDEX idx_wallets_user_id ON wallets(user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_wallets_stellar_public_key ON wallets(stellar_public_key);
CREATE INDEX idx_wallets_status ON wallets(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_wallets_type ON wallets(wallet_type);

-- Create indexes for wallet_balances
CREATE INDEX idx_wallet_balances_wallet_id ON wallet_balances(wallet_id);
CREATE INDEX idx_wallet_balances_asset ON wallet_balances(asset_type, asset_code, asset_issuer);

-- Create indexes for wallet_transactions
CREATE INDEX idx_wallet_transactions_wallet_id ON wallet_transactions(wallet_id);
CREATE INDEX idx_wallet_transactions_stellar_tx_hash ON wallet_transactions(stellar_tx_hash);
CREATE INDEX idx_wallet_transactions_stellar_ledger ON wallet_transactions(stellar_ledger);
CREATE INDEX idx_wallet_transactions_created_at ON wallet_transactions(created_at);
CREATE INDEX idx_wallet_transactions_from_to ON wallet_transactions(from_address, to_address);

-- Add constraints
ALTER TABLE wallets ADD CONSTRAINT check_stellar_key_format CHECK (stellar_public_key ~ '^G[A-Z2-7]{55}$');
ALTER TABLE wallet_balances ADD CONSTRAINT check_balance_positive CHECK (balance >= 0);

-- Add comments
COMMENT ON TABLE wallets IS 'User wallets with Stellar blockchain integration';
COMMENT ON TABLE wallet_balances IS 'Multi-asset balance tracking for each wallet';
COMMENT ON TABLE wallet_transactions IS 'Transaction history synced from Stellar blockchain';
COMMENT ON COLUMN wallets.trusted_assets IS 'JSON array of assets this wallet has trustlines for';
COMMENT ON COLUMN wallet_transactions.stellar_tx_hash IS 'Stellar transaction hash for blockchain verification';
