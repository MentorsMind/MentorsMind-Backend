-- =============================================================================
-- Migration: 161_add_no_show_penalty_workflow.sql
-- Description: No-show dispute window, penalty points, and refund/payout split
--              tracking for the session no-show detection workflow (#983)
-- =============================================================================

-- ---------------------------------------------------------------
-- Extend bookings with dispute + penalty tracking columns
-- ---------------------------------------------------------------
ALTER TABLE bookings
    ADD COLUMN IF NOT EXISTS no_show_offender_role VARCHAR(20),
    ADD COLUMN IF NOT EXISTS no_show_dispute_deadline TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS no_show_disputed_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS no_show_dispute_status VARCHAR(20) NOT NULL DEFAULT 'none'
        CHECK (no_show_dispute_status IN ('none', 'pending', 'approved', 'dismissed')),
    ADD COLUMN IF NOT EXISTS no_show_dispute_reason TEXT,
    ADD COLUMN IF NOT EXISTS no_show_penalty_points INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS no_show_refund_percent NUMERIC(5, 2),
    ADD COLUMN IF NOT EXISTS no_show_payout_percent NUMERIC(5, 2),
    ADD COLUMN IF NOT EXISTS no_show_refund_amount VARCHAR(255),
    ADD COLUMN IF NOT EXISTS no_show_payout_amount VARCHAR(255);

-- ---------------------------------------------------------------
-- No-show penalties ledger (strikes against mentor / mentee accounts)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS no_show_penalties (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id    UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    offender_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    offender_role VARCHAR(20) NOT NULL CHECK (offender_role IN ('mentor', 'mentee')),
    penalty_points INT NOT NULL DEFAULT 0,
    status        VARCHAR(20) NOT NULL DEFAULT 'applied'
        CHECK (status IN ('applied', 'disputed', 'waived', 'served')),
    dispute_deadline TIMESTAMP WITH TIME ZONE,
    disputed_at      TIMESTAMP WITH TIME ZONE,
    dispute_reason   TEXT,
    resolution       VARCHAR(20),
    resolved_by      UUID REFERENCES users(id),
    resolved_at      TIMESTAMP WITH TIME ZONE,
    created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_no_show_penalties_booking ON no_show_penalties(booking_id);
CREATE INDEX IF NOT EXISTS idx_no_show_penalties_offender ON no_show_penalties(offender_id, status);
CREATE INDEX IF NOT EXISTS idx_bookings_no_show_dispute ON bookings(no_show_dispute_status, no_show_dispute_deadline);

-- ---------------------------------------------------------------
-- Per-user aggregates for penalty enforcement / account standing
-- ---------------------------------------------------------------
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS no_show_count INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS active_penalty_points INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN bookings.no_show_offender_role IS 'Role that missed the session (mentor | mentee)';
COMMENT ON COLUMN bookings.no_show_dispute_deadline IS 'Timestamp after which the offender can no longer dispute the no-show';
COMMENT ON COLUMN bookings.no_show_dispute_status IS 'Dispute lifecycle: none -> pending -> approved | dismissed';
COMMENT ON COLUMN bookings.no_show_penalty_points IS 'Penalty points levied against the no-show offender';
COMMENT ON COLUMN bookings.no_show_refund_percent IS 'Configured percentage of the escrow refunded to the mentee';
COMMENT ON COLUMN bookings.no_show_payout_percent IS 'Configured percentage of the escrow paid out to the mentor';
COMMENT ON TABLE no_show_penalties IS 'Ledger of no-show penalty strikes, dispute state, and resolutions';
COMMENT ON COLUMN users.active_penalty_points IS 'Outstanding penalty points that may affect account standing';