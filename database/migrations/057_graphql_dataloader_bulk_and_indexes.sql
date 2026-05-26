-- =============================================================================
-- Migration: 057_graphql_dataloader_bulk_and_indexes.sql
-- Description: Support GraphQL DataLoader bulk batching and add/verify key indexes.
-- =============================================================================

-- Transactions / payments are stored in transactions table.
-- DataLoader bulk-fetches by user_id and sorts by created_at.
CREATE INDEX IF NOT EXISTS idx_transactions_user_created_at_desc
  ON transactions(user_id, created_at DESC);

-- Disputes and escrow tables are queried by status and foreign keys in admin/resolve flows.
CREATE INDEX IF NOT EXISTS idx_disputes_reporter_id
  ON disputes(reporter_id);

CREATE INDEX IF NOT EXISTS idx_disputes_transaction_id_status
  ON disputes(transaction_id, status);

-- Reviews are queried by reviewer_id/reviewee_id and sorted by created_at.
CREATE INDEX IF NOT EXISTS idx_reviews_reviewer_created_at_desc
  ON reviews(reviewer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reviews_reviewee_created_at_desc
  ON reviews(reviewee_id, created_at DESC);

-- Bookings are queried by mentee_id/mentor_id and filtered by status and sorted by scheduled_at.
CREATE INDEX IF NOT EXISTS idx_bookings_mentee_status_scheduled_at_desc
  ON bookings(mentee_id, status, scheduled_at DESC);

CREATE INDEX IF NOT EXISTS idx_bookings_mentor_status_scheduled_at_desc
  ON bookings(mentor_id, status, scheduled_at DESC);

-- Escrow transactions table (if exists) is frequently filtered by buyer/seller.
-- Use IF EXISTS to avoid migration failures in older schemas.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'escrow_transactions'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_escrow_transactions_buyer_id
      ON escrow_transactions(buyer_id);

    CREATE INDEX IF NOT EXISTS idx_escrow_transactions_seller_id
      ON escrow_transactions(seller_id);
  END IF;
END $$;

