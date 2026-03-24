-- =============================================================================
-- Migration: 006_create_indexes.sql
-- Description: Additional performance indexes and composite indexes
-- =============================================================================

-- ============================================================================
-- Users Table - Additional Indexes
-- ============================================================================

-- Composite index for mentor search with filters
CREATE INDEX idx_users_mentor_search ON users(role, is_available, average_rating DESC, total_reviews DESC)
    WHERE role = 'mentor' AND status = 'active' AND deleted_at IS NULL;

-- Index for user authentication
CREATE INDEX idx_users_auth_lookup ON users(email, status) WHERE deleted_at IS NULL;

-- Index for locked accounts
CREATE INDEX idx_users_locked ON users(locked_until) WHERE locked_until IS NOT NULL AND locked_until > NOW();

-- ============================================================================
-- Wallets Table - Additional Indexes
-- ============================================================================

-- Composite index for active user wallets
CREATE INDEX idx_wallets_active_user ON wallets(user_id, status) 
    WHERE status = 'active' AND deleted_at IS NULL;

-- Index for balance updates
CREATE INDEX idx_wallets_balance_update ON wallets(last_balance_update) 
    WHERE last_balance_update IS NOT NULL;

-- ============================================================================
-- Transactions Table - Additional Indexes
-- ============================================================================

-- Composite index for user transaction history
CREATE INDEX idx_transactions_user_history ON transactions(user_id, created_at DESC, status);

-- Index for pending transactions requiring processing
CREATE INDEX idx_transactions_pending ON transactions(status, created_at) 
    WHERE status IN ('pending', 'processing');

-- Index for failed transactions needing retry
CREATE INDEX idx_transactions_failed_retry ON transactions(status, retry_count, created_at)
    WHERE status = 'failed' AND retry_count < 3;

-- Composite index for transaction analytics
CREATE INDEX idx_transactions_analytics ON transactions(type, status, completed_at, currency)
    WHERE status = 'completed';

-- Index for booking-related transactions
CREATE INDEX idx_transactions_booking_lookup ON transactions(booking_id, type, status)
    WHERE booking_id IS NOT NULL;

-- ============================================================================
-- Bookings Table - Additional Indexes
-- ============================================================================

-- Composite index for mentor dashboard
CREATE INDEX idx_bookings_mentor_dashboard ON bookings(mentor_id, status, scheduled_start DESC);

-- Composite index for mentee dashboard
CREATE INDEX idx_bookings_mentee_dashboard ON bookings(mentee_id, status, scheduled_start DESC);

-- Index for payment processing
CREATE INDEX idx_bookings_payment_processing ON bookings(payment_status, status)
    WHERE payment_status IN ('unpaid', 'held_in_escrow');

-- Index for upcoming sessions requiring reminders
CREATE INDEX idx_bookings_reminders ON bookings(scheduled_start, reminder_sent_mentee, reminder_sent_mentor)
    WHERE status IN ('confirmed', 'pending') 
    AND scheduled_start > NOW() 
    AND scheduled_start < NOW() + INTERVAL '24 hours';

-- Index for completed sessions without reviews
CREATE INDEX idx_bookings_needs_review ON bookings(status, completed_at)
    WHERE status = 'completed' AND completed_at IS NOT NULL;

-- Composite index for booking analytics
CREATE INDEX idx_bookings_analytics ON bookings(mentor_id, status, completed_at)
    WHERE status = 'completed';

-- ============================================================================
-- Reviews Table - Additional Indexes
-- ============================================================================

-- Composite index for mentor profile reviews
CREATE INDEX idx_reviews_mentor_profile ON reviews(reviewee_id, is_published, rating, created_at DESC)
    WHERE is_published = TRUE;

-- Index for recent reviews
CREATE INDEX idx_reviews_recent ON reviews(created_at DESC, is_published)
    WHERE is_published = TRUE;

-- Index for moderation queue
CREATE INDEX idx_reviews_moderation ON reviews(is_flagged, moderated_at)
    WHERE is_flagged = TRUE AND moderated_at IS NULL;

-- ============================================================================
-- Wallet Balances - Additional Indexes
-- ============================================================================

-- Index for non-zero balances
CREATE INDEX idx_wallet_balances_nonzero ON wallet_balances(wallet_id, balance)
    WHERE balance > 0;

-- ============================================================================
-- Transaction Events - Additional Indexes
-- ============================================================================

-- Composite index for transaction audit trail
CREATE INDEX idx_transaction_events_audit ON transaction_events(transaction_id, created_at DESC);

-- ============================================================================
-- Full-Text Search Indexes (PostgreSQL specific)
-- ============================================================================

-- Full-text search on user profiles
CREATE INDEX idx_users_fulltext ON users USING GIN(
    to_tsvector('english', COALESCE(full_name, '') || ' ' || COALESCE(bio, '') || ' ' || COALESCE(username, ''))
) WHERE role = 'mentor' AND deleted_at IS NULL;

-- Full-text search on booking descriptions
CREATE INDEX idx_bookings_fulltext ON bookings USING GIN(
    to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(description, ''))
);

-- ============================================================================
-- JSONB Indexes for metadata fields
-- ============================================================================

-- Index for user metadata queries
CREATE INDEX idx_users_metadata ON users USING GIN(metadata);

-- Index for transaction metadata queries
CREATE INDEX idx_transactions_metadata ON transactions USING GIN(metadata);

-- Index for booking metadata queries
CREATE INDEX idx_bookings_metadata ON bookings USING GIN(metadata);

-- Index for wallet trusted assets
CREATE INDEX idx_wallets_trusted_assets ON wallets USING GIN(trusted_assets);

-- ============================================================================
-- Partial Indexes for Common Queries
-- ============================================================================

-- Active mentors only
CREATE INDEX idx_active_mentors ON users(id, average_rating, total_reviews)
    WHERE role = 'mentor' AND status = 'active' AND is_available = TRUE AND deleted_at IS NULL;

-- Verified users only
CREATE INDEX idx_verified_users ON users(id, role)
    WHERE email_verified = TRUE AND status = 'active' AND deleted_at IS NULL;

-- Completed transactions only
CREATE INDEX idx_completed_transactions ON transactions(user_id, completed_at DESC, amount)
    WHERE status = 'completed';

-- Active bookings only
CREATE INDEX idx_active_bookings ON bookings(mentor_id, mentee_id, scheduled_start)
    WHERE status IN ('pending', 'confirmed', 'in_progress');

-- Add comments
COMMENT ON INDEX idx_users_mentor_search IS 'Optimizes mentor search and filtering queries';
COMMENT ON INDEX idx_transactions_pending IS 'Speeds up processing of pending transactions';
COMMENT ON INDEX idx_bookings_reminders IS 'Optimizes reminder notification queries';
COMMENT ON INDEX idx_users_fulltext IS 'Enables full-text search on mentor profiles';
