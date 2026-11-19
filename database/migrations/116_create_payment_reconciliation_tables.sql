ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS payment_rail VARCHAR(32),
    ADD COLUMN IF NOT EXISTS external_reference VARCHAR(255);

-- Payment reconciliation discrepancies between Stripe and Stellar rails.
CREATE TABLE IF NOT EXISTS payment_reconciliation_discrepancy (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL,
    user_id UUID,
    transaction_id UUID,
    payment_rail VARCHAR(32),
    discrepancy_type VARCHAR(64) NOT NULL,
    expected_status VARCHAR(32) NOT NULL,
    actual_status VARCHAR(128) NOT NULL,
    external_reference VARCHAR(255),
    review_status VARCHAR(32) NOT NULL DEFAULT 'open' CHECK (review_status IN ('open', 'under_review', 'resolved', 'ignored')),
    reviewed_by UUID,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_reconciliation_booking_id
    ON payment_reconciliation_discrepancy (booking_id);
CREATE INDEX IF NOT EXISTS idx_payment_reconciliation_review_status
    ON payment_reconciliation_discrepancy (review_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_reconciliation_transaction_id
    ON payment_reconciliation_discrepancy (transaction_id);

COMMENT ON TABLE payment_reconciliation_discrepancy IS 'Manual review queue for mismatched Stripe/Stellar payment records.';
