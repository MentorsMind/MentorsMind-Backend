-- =============================================================================
-- Migration: 113_add_referral_reward_transaction_type.sql
-- Description: Add 'referral_reward' to transaction_type enum
-- =============================================================================

-- Add new value to existing enum
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'referral_reward';

COMMENT ON TYPE transaction_type IS 'Transaction types including referral rewards';
