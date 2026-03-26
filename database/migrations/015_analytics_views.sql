-- =============================================================================
-- Migration: 015_analytics_views.sql
-- Description: Create materialized views for analytics performance
-- =============================================================================

-- Daily revenue aggregation
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_revenue AS
SELECT 
    DATE(created_at) as date,
    currency,
    COUNT(*) as transaction_count,
    SUM(amount) as total_amount,
    SUM(platform_fee) as total_platform_fee,
    AVG(amount) as avg_amount
FROM transactions
WHERE status = 'completed'
GROUP BY DATE(created_at), currency
ORDER BY date DESC;

CREATE UNIQUE INDEX idx_mv_daily_revenue_date_currency ON mv_daily_revenue(date, currency);

-- Daily user registrations
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_users AS
SELECT 
    DATE(created_at) as date,
    role,
    COUNT(*) as new_users,
    COUNT(*) FILTER (WHERE email_verified = true) as verified_users
FROM users
WHERE deleted_at IS NULL
GROUP BY DATE(created_at), role
ORDER BY date DESC;

CREATE UNIQUE INDEX idx_mv_daily_users_date_role ON mv_daily_users(date, role);

-- Session statistics
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_session_stats AS
SELECT 
    DATE(scheduled_at) as date,
    status,
    COUNT(*) as session_count,
    AVG(EXTRACT(EPOCH FROM (completed_at - scheduled_at))/60) as avg_duration_minutes
FROM bookings
GROUP BY DATE(scheduled_at), status
ORDER BY date DESC;

CREATE UNIQUE INDEX idx_mv_session_stats_date_status ON mv_session_stats(date, status);

-- Top mentors by revenue
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_top_mentors AS
SELECT 
    u.id,
    u.full_name,
    u.email,
    COUNT(DISTINCT b.id) as total_sessions,
    SUM(t.amount) as total_revenue,
    AVG(r.rating) as avg_rating,
    COUNT(DISTINCT r.id) as review_count
FROM users u
LEFT JOIN bookings b ON u.id = b.mentor_id AND b.status = 'completed'
LEFT JOIN transactions t ON b.id = t.booking_id AND t.status = 'completed'
LEFT JOIN reviews r ON b.id = r.booking_id
WHERE u.role = 'mentor' AND u.deleted_at IS NULL
GROUP BY u.id, u.full_name, u.email
ORDER BY total_revenue DESC NULLS LAST
LIMIT 100;

CREATE UNIQUE INDEX idx_mv_top_mentors_id ON mv_top_mentors(id);

-- Asset distribution
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_asset_distribution AS
SELECT 
    currency,
    COUNT(*) as transaction_count,
    SUM(amount) as total_volume,
    ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) as percentage
FROM transactions
WHERE status = 'completed'
GROUP BY currency;

CREATE UNIQUE INDEX idx_mv_asset_distribution_currency ON mv_asset_distribution(currency);

-- Add comments
COMMENT ON MATERIALIZED VIEW mv_daily_revenue IS 'Daily revenue aggregation for analytics dashboard';
COMMENT ON MATERIALIZED VIEW mv_daily_users IS 'Daily user registration statistics';
COMMENT ON MATERIALIZED VIEW mv_session_stats IS 'Session completion and duration statistics';
COMMENT ON MATERIALIZED VIEW mv_top_mentors IS 'Top performing mentors by revenue and sessions';
COMMENT ON MATERIALIZED VIEW mv_asset_distribution IS 'Payment asset distribution (XLM, USDC, PYUSD)';

-- Function to refresh all analytics views
CREATE OR REPLACE FUNCTION refresh_analytics_views()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_revenue;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_users;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_session_stats;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_top_mentors;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_asset_distribution;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION refresh_analytics_views IS 'Refresh all analytics materialized views';
