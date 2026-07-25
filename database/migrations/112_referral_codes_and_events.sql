-- =============================================================================
-- Migration: 112_referral_codes_and_events.sql
-- Description: Create referral_codes and referral_events tables for referral reward system
-- =============================================================================

-- Drop tables if they exist (for idempotency)
DROP TABLE IF EXISTS referral_events CASCADE;
DROP TABLE IF EXISTS referral_codes CASCADE;

-- Create referral_codes table
CREATE TABLE referral_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code VARCHAR(8) NOT NULL UNIQUE,
    uses_remaining INTEGER, -- NULL means unlimited
    current_uses INTEGER DEFAULT 0,
    expires_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create referral_events table (audit trail for all referral actions)
CREATE TABLE referral_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(50) NOT NULL, -- 'code_generated', 'code_applied', 'reward_qualified', 'reward_held', 'reward_paid', 'fraud_detected'
    referrer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    referee_id UUID REFERENCES users(id) ON DELETE SET NULL,
    referral_code VARCHAR(8) NOT NULL,
    reward_amount NUMERIC(15, 7),
    reward_currency VARCHAR(10) DEFAULT 'XLM',
    reward_status VARCHAR(20), -- 'pending', 'held', 'paid', 'rejected'
    qualifying_booking_id UUID, -- References bookings table
    stellar_tx_hash VARCHAR(64),
    payout_scheduled_at TIMESTAMP WITH TIME ZONE, -- 7 days after qualification
    payout_completed_at TIMESTAMP WITH TIME ZONE,
    fraud_flags JSONB DEFAULT '[]', -- Array of fraud indicators: ['same_ip', 'rapid_creation', 'same_device']
    metadata JSONB DEFAULT '{}', -- Additional context (IP, device fingerprint, etc.)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_referral_codes_owner_id ON referral_codes(owner_id);
CREATE INDEX idx_referral_codes_code ON referral_codes(code);
CREATE INDEX idx_referral_codes_active ON referral_codes(is_active) WHERE is_active = true;
CREATE INDEX idx_referral_events_referrer ON referral_events(referrer_id);
CREATE INDEX idx_referral_events_referee ON referral_events(referee_id);
CREATE INDEX idx_referral_events_code ON referral_events(referral_code);
CREATE INDEX idx_referral_events_type ON referral_events(event_type);
CREATE INDEX idx_referral_events_status ON referral_events(reward_status);
CREATE INDEX idx_referral_events_payout_scheduled ON referral_events(payout_scheduled_at) WHERE reward_status = 'held';

-- Add trigger to update updated_at
CREATE OR REPLACE FUNCTION update_referral_codes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_referral_codes_updated_at
    BEFORE UPDATE ON referral_codes
    FOR EACH ROW
    EXECUTE FUNCTION update_referral_codes_updated_at();

-- Add referred_by field to users table if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'referred_by'
    ) THEN
        ALTER TABLE users ADD COLUMN referred_by UUID REFERENCES users(id) ON DELETE SET NULL;
        CREATE INDEX idx_users_referred_by ON users(referred_by);
    END IF;
END $$;

-- Comments for documentation
COMMENT ON TABLE referral_codes IS 'Stores unique referral codes for users to share';
COMMENT ON TABLE referral_events IS 'Audit trail for all referral-related events including fraud detection';
COMMENT ON COLUMN referral_events.fraud_flags IS 'Array of fraud indicators detected during validation';
COMMENT ON COLUMN referral_events.payout_scheduled_at IS '7-day hold period after qualifying event before payout';
