-- Migration: 061_add_on_chain_pending_to_verifications.sql
-- Add on_chain_pending column to track pending on-chain verification transactions

ALTER TABLE mentor_verifications
ADD COLUMN IF NOT EXISTS on_chain_pending BOOLEAN NOT NULL DEFAULT FALSE;

-- Add index for pending on-chain verifications
CREATE INDEX IF NOT EXISTS idx_mentor_verifications_on_chain_pending
ON mentor_verifications(on_chain_pending)
WHERE on_chain_pending = TRUE;

COMMENT ON COLUMN mentor_verifications.on_chain_pending IS 'Flag indicating if on-chain verification transaction is pending confirmation';
