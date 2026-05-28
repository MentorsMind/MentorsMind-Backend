-- =============================================================================
-- Migration: 067_enhance_dispute_system.sql
-- Description: Overhaul disputes table to fix transaction_id bug and add new fields
-- =============================================================================

-- We first need to drop the existing foreign key and rename the column
ALTER TABLE disputes 
  DROP CONSTRAINT IF EXISTS disputes_transaction_id_fkey,
  RENAME COLUMN transaction_id TO session_id;

-- Now reference the bookings table correctly
ALTER TABLE disputes
  ADD CONSTRAINT disputes_session_id_fkey FOREIGN KEY (session_id) REFERENCES bookings(id);

-- Rename reporter_id to filed_by_id
ALTER TABLE disputes
  RENAME COLUMN reporter_id TO filed_by_id;

-- Add new columns
ALTER TABLE disputes
  ADD COLUMN respondent_id UUID REFERENCES users(id),
  ADD COLUMN type VARCHAR(50) DEFAULT 'quality',
  ADD COLUMN resolved_at TIMESTAMP WITH TIME ZONE;

-- Update the status constraint/values (since it's a VARCHAR, we don't need to ALTER TYPE, just assume the code handles the new enum values)
-- We will migrate 'under_review' to 'investigating' for existing records
UPDATE disputes SET status = 'investigating' WHERE status = 'under_review';

-- Create indexes for the new column
CREATE INDEX IF NOT EXISTS idx_disputes_respondent_id ON disputes(respondent_id);
CREATE INDEX IF NOT EXISTS idx_disputes_session_id ON disputes(session_id);

-- Add comments
COMMENT ON COLUMN disputes.session_id IS 'References the bookings table (was previously named transaction_id)';
COMMENT ON COLUMN disputes.type IS 'Dispute type: payment, quality, conduct, cancellation';
