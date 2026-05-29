-- =============================================================================
-- MentorsMind Platform - Complete Database Schema
-- Description: Complete PostgreSQL schema with Stellar blockchain integration
-- Version: 1.0.0
-- =============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- ENUMS
-- =============================================================================

-- User related enums
CREATE TYPE user_role AS ENUM ('mentee', 'mentor', 'admin');
CREATE TYPE user_status AS ENUM ('active', 'inactive', 'suspended', 'pending_verification');

-- Wallet related enums
CREATE TYPE wallet_status AS ENUM ('active', 'frozen', 'closed');

-- Transaction related enums
CREATE TYPE transaction_type AS ENUM (
    'deposit', 'withdrawal', 'payment', 'refund',
    'platform_fee', 'mentor_payout', 'escrow_hold', 'escrow_release'
);
CREATE TYPE transaction_status AS ENUM (
    'pending', 'processing', 'completed', 'failed', 'cancelled', 'refunded'
);

-- Booking related enums
CREATE TYPE booking_status AS ENUM (
    'pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'
);
CREATE TYPE payment_status AS ENUM (
    'unpaid', 'paid', 'held_in_escrow', 'released', 'refunded', 'disputed'
);

-- =============================================================================
-- TABLES
-- =============================================================================

-- Users table
\i 001_create_users.sql

-- Wallets table
\i 002_create_wallets.sql

-- Transactions table
\i 003_create_transactions.sql

-- Bookings table
\i 004_create_bookings.sql

-- Reviews table
\i 005_create_reviews.sql

-- Additional tables (from existing models)

-- Audit logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    level VARCHAR(20) NOT NULL,
    action VARCHAR(100) NOT NULL,
    message TEXT NOT NULL,
    user_id UUID REFERENCES users(id),
    entity_type VARCHAR(100),
    entity_id VARCHAR(255),
    metadata JSONB DEFAULT '{}'::jsonb,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);

-- Disputes table
CREATE TABLE IF NOT EXISTS disputes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(id),
    reporter_id UUID NOT NULL REFERENCES users(id),
    reason TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    resolution_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_disputes_status ON disputes(status);
CREATE INDEX idx_disputes_transaction_id ON disputes(transaction_id);

-- System configs table
CREATE TABLE IF NOT EXISTS system_configs (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- INDEXES
-- =============================================================================

\i 006_create_indexes.sql

-- =============================================================================
-- TRIGGERS
-- =============================================================================

\i 007_create_triggers.sql

-- =============================================================================
-- VIEWS
-- =============================================================================

-- View: Active mentors with statistics
CREATE OR REPLACE VIEW v_active_mentors AS
SELECT 
    u.id,
    u.username,
    u.full_name,
    u.email,
    u.bio,
    u.avatar_url,
    u.expertise,
    u.hourly_rate,
    u.years_of_experience,
    u.average_rating,
    u.total_reviews,
    u.total_sessions_completed,
    u.is_available,
    u.created_at
FROM users u
WHERE u.role = 'mentor'
    AND u.status = 'active'
    AND u.deleted_at IS NULL
ORDER BY u.average_rating DESC, u.total_reviews DESC;

-- View: Transaction summary by user
CREATE OR REPLACE VIEW v_user_transaction_summary AS
SELECT 
    user_id,
    COUNT(*) as total_transactions,
    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_transactions,
    SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END) as total_volume,
    SUM(CASE WHEN status = 'completed' THEN platform_fee ELSE 0 END) as total_fees_paid,
    MAX(created_at) as last_transaction_date
FROM transactions
GROUP BY user_id;

-- View: Booking statistics by mentor
CREATE OR REPLACE VIEW v_mentor_booking_stats AS
SELECT 
    mentor_id,
    COUNT(*) as total_bookings,
    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_bookings,
    SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_bookings,
    SUM(CASE WHEN status = 'no_show' THEN 1 ELSE 0 END) as no_show_count,
    SUM(CASE WHEN status = 'completed' THEN mentor_payout ELSE 0 END) as total_earnings,
    AVG(CASE WHEN status = 'completed' THEN amount ELSE NULL END) as avg_session_price
FROM bookings
GROUP BY mentor_id;

-- View: Upcoming bookings
CREATE OR REPLACE VIEW v_upcoming_bookings AS
SELECT 
    b.id,
    b.mentee_id,
    b.mentor_id,
    b.title,
    b.scheduled_start,
    b.scheduled_end,
    b.duration_minutes,
    b.status,
    b.payment_status,
    b.amount,
    mentee.full_name as mentee_name,
    mentee.email as mentee_email,
    mentor.full_name as mentor_name,
    mentor.email as mentor_email
FROM bookings b
JOIN users mentee ON b.mentee_id = mentee.id
JOIN users mentor ON b.mentor_id = mentor.id
WHERE b.status IN ('pending', 'confirmed')
    AND b.scheduled_start > NOW()
ORDER BY b.scheduled_start ASC;

-- =============================================================================
-- FUNCTIONS
-- =============================================================================

-- Function: Get user wallet balance
CREATE OR REPLACE FUNCTION get_user_wallet_balance(p_user_id UUID, p_asset_code VARCHAR DEFAULT NULL)
RETURNS TABLE (
    asset_type VARCHAR,
    asset_code VARCHAR,
    asset_issuer VARCHAR,
    balance DECIMAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        wb.asset_type,
        wb.asset_code,
        wb.asset_issuer,
        wb.balance
    FROM wallet_balances wb
    JOIN wallets w ON wb.wallet_id = w.id
    WHERE w.user_id = p_user_id
        AND w.status = 'active'
        AND (p_asset_code IS NULL OR wb.asset_code = p_asset_code);
END;
$$ LANGUAGE plpgsql;

-- Function: Calculate platform statistics
CREATE OR REPLACE FUNCTION get_platform_statistics()
RETURNS TABLE (
    total_users BIGINT,
    total_mentors BIGINT,
    total_mentees BIGINT,
    total_bookings BIGINT,
    completed_bookings BIGINT,
    total_transactions BIGINT,
    total_volume DECIMAL,
    total_platform_fees DECIMAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL),
        (SELECT COUNT(*) FROM users WHERE role = 'mentor' AND deleted_at IS NULL),
        (SELECT COUNT(*) FROM users WHERE role = 'mentee' AND deleted_at IS NULL),
        (SELECT COUNT(*) FROM bookings),
        (SELECT COUNT(*) FROM bookings WHERE status = 'completed'),
        (SELECT COUNT(*) FROM transactions),
        (SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE status = 'completed'),
        (SELECT COALESCE(SUM(platform_fee), 0) FROM transactions WHERE status = 'completed');
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- GRANTS (adjust based on your user roles)
-- =============================================================================

-- Grant permissions to application user (adjust username as needed)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mentorminds_app;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mentorminds_app;
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO mentorminds_app;

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON DATABASE mentorminds IS 'MentorsMind platform database with Stellar blockchain integration';
COMMENT ON SCHEMA public IS 'Main schema for MentorsMind application';

-- =============================================================================
-- END OF SCHEMA
-- =============================================================================
