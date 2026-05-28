-- =============================================================================
-- Migration: 020_advanced_analytics.sql
-- Description: Advanced Analytics Dashboard - Database Schema
-- =============================================================================

-- Analytics predictions cache
CREATE TABLE analytics_predictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prediction_type VARCHAR(50) NOT NULL, -- 'revenue_forecast', 'demand_forecast'
    target_date DATE NOT NULL,
    predicted_value NUMERIC(15, 2),
    confidence_interval_lower NUMERIC(15, 2),
    confidence_interval_upper NUMERIC(15, 2),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(prediction_type, target_date)
);

CREATE INDEX idx_predictions_type_date ON analytics_predictions(prediction_type, target_date);
CREATE INDEX idx_predictions_created ON analytics_predictions(created_at DESC);

-- User cohorts tracking
CREATE TABLE user_cohorts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cohort_date DATE NOT NULL,
    cohort_type VARCHAR(50) NOT NULL, -- 'weekly', 'monthly'
    role VARCHAR(20) NOT NULL,
    user_count INTEGER NOT NULL DEFAULT 0,
    retained_1week INTEGER DEFAULT 0,
    retained_1month INTEGER DEFAULT 0,
    retained_3month INTEGER DEFAULT 0,
    retained_6month INTEGER DEFAULT 0,
    total_revenue NUMERIC(15, 2) DEFAULT 0,
    avg_lifetime_value NUMERIC(15, 2) DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(cohort_date, cohort_type, role)
);

CREATE INDEX idx_cohorts_date_type ON user_cohorts(cohort_date DESC, cohort_type);
CREATE INDEX idx_cohorts_role ON user_cohorts(role);

-- Custom report configurations
CREATE TABLE custom_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    config JSONB NOT NULL, -- metrics, filters, visualizations
    schedule VARCHAR(50), -- 'daily', 'weekly', 'monthly', null for manual
    is_shared BOOLEAN DEFAULT false,
    last_generated_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_custom_reports_user ON custom_reports(user_id);
CREATE INDEX idx_custom_reports_schedule ON custom_reports(schedule) WHERE schedule IS NOT NULL;
-- Analytics insights
CREATE TABLE analytics_insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    insight_type VARCHAR(50) NOT NULL, -- 'trend', 'anomaly', 'recommendation'
    severity VARCHAR(20) NOT NULL, -- 'info', 'warning', 'critical'
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    metric_name VARCHAR(100),
    metric_value NUMERIC(15, 2),
    metadata JSONB DEFAULT '{}',
    is_read BOOLEAN DEFAULT false,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_insights_type_severity ON analytics_insights(insight_type, severity);
CREATE INDEX idx_insights_created ON analytics_insights(created_at DESC);
CREATE INDEX idx_insights_unread ON analytics_insights(is_read) WHERE is_read = false;

-- Alert thresholds configuration
CREATE TABLE analytics_alert_thresholds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    metric_name VARCHAR(100) NOT NULL,
    threshold_type VARCHAR(50) NOT NULL, -- 'above', 'below', 'change_percent'
    threshold_value NUMERIC(15, 2) NOT NULL,
    comparison_period VARCHAR(50), -- 'previous_day', 'previous_week', etc.
    notification_channels TEXT[] DEFAULT ARRAY['email'], -- 'email', 'sms', 'in_app'
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(metric_name, threshold_type)
);

CREATE INDEX idx_alert_thresholds_active ON analytics_alert_thresholds(is_active) WHERE is_active = true;

-- Dashboard widget preferences
CREATE TABLE dashboard_widgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    widget_type VARCHAR(50) NOT NULL,
    position INTEGER NOT NULL,
    size VARCHAR(20) NOT NULL, -- 'small', 'medium', 'large'
    config JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_dashboard_widgets_user ON dashboard_widgets(user_id, position);
-- New Materialized Views for Advanced Analytics

-- Hourly session demand (for prediction model)
CREATE MATERIALIZED VIEW mv_hourly_session_demand AS
SELECT 
    DATE_TRUNC('hour', scheduled_at) as hour,
    EXTRACT(DOW FROM scheduled_at) as day_of_week,
    EXTRACT(HOUR FROM scheduled_at) as hour_of_day,
    COUNT(*) as booking_count,
    COUNT(DISTINCT mentor_id) as active_mentors,
    AVG(EXTRACT(EPOCH FROM (completed_at - scheduled_at))/60) as avg_duration_minutes
FROM bookings
WHERE status IN ('completed', 'confirmed')
  AND scheduled_at >= CURRENT_DATE - INTERVAL '1 year'
GROUP BY DATE_TRUNC('hour', scheduled_at), EXTRACT(DOW FROM scheduled_at), EXTRACT(HOUR FROM scheduled_at);

CREATE UNIQUE INDEX idx_mv_hourly_demand ON mv_hourly_session_demand(hour);

-- Mentor performance metrics
CREATE MATERIALIZED VIEW mv_mentor_performance AS
SELECT 
    u.id as mentor_id,
    u.full_name,
    COUNT(DISTINCT b.id) as total_sessions,
    COUNT(DISTINCT b.id) FILTER (WHERE b.status = 'completed') as completed_sessions,
    COUNT(DISTINCT b.id) FILTER (WHERE b.status = 'cancelled') as cancelled_sessions,
    AVG(r.rating) as avg_rating,
    COUNT(DISTINCT r.id) as review_count,
    SUM(t.amount) as total_revenue,
    AVG(t.amount) as avg_session_price,
    COUNT(DISTINCT b.learner_id) as unique_students,
    MAX(b.scheduled_at) as last_session_date
FROM users u
LEFT JOIN bookings b ON u.id = b.mentor_id
LEFT JOIN reviews r ON b.id = r.booking_id
LEFT JOIN transactions t ON b.id = t.booking_id AND t.status = 'completed'
WHERE u.role = 'mentor' AND u.deleted_at IS NULL
GROUP BY u.id, u.full_name;

CREATE UNIQUE INDEX idx_mv_mentor_performance ON mv_mentor_performance(mentor_id);

-- Revenue by time period (for forecasting)
CREATE MATERIALIZED VIEW mv_revenue_time_series AS
SELECT 
    DATE_TRUNC('day', created_at) as date,
    EXTRACT(DOW FROM created_at) as day_of_week,
    EXTRACT(MONTH FROM created_at) as month,
    EXTRACT(YEAR FROM created_at) as year,
    currency,
    SUM(amount) as total_amount,
    SUM(platform_fee) as total_platform_fee,
    COUNT(*) as transaction_count,
    AVG(amount) as avg_amount
FROM transactions
WHERE status = 'completed'
  AND created_at >= CURRENT_DATE - INTERVAL '2 years'
GROUP BY DATE_TRUNC('day', created_at), EXTRACT(DOW FROM created_at), 
         EXTRACT(MONTH FROM created_at), EXTRACT(YEAR FROM created_at), currency;

CREATE UNIQUE INDEX idx_mv_revenue_ts ON mv_revenue_time_series(date, currency);
-- Optimize existing tables for analytics queries
CREATE INDEX IF NOT EXISTS idx_transactions_created_status ON transactions(created_at DESC, status);
CREATE INDEX IF NOT EXISTS idx_bookings_scheduled_status ON bookings(scheduled_at DESC, status);
CREATE INDEX IF NOT EXISTS idx_users_created_role ON users(created_at DESC, role) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_reviews_created_rating ON reviews(created_at DESC, rating);

-- Enhanced refresh function for all analytics views
CREATE OR REPLACE FUNCTION refresh_advanced_analytics_views()
RETURNS void AS $$
BEGIN
    -- Refresh existing views
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_revenue;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_users;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_session_stats;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_top_mentors;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_asset_distribution;
    
    -- Refresh new advanced views
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_hourly_session_demand;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_mentor_performance;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_revenue_time_series;
END;
$$ LANGUAGE plpgsql;

-- Database triggers for real-time analytics updates
CREATE OR REPLACE FUNCTION notify_analytics_event()
RETURNS trigger AS $$
BEGIN
    -- Notify analytics pipeline of data changes
    PERFORM pg_notify('analytics_event', json_build_object(
        'table', TG_TABLE_NAME,
        'operation', TG_OP,
        'id', COALESCE(NEW.id, OLD.id),
        'timestamp', CURRENT_TIMESTAMP
    )::text);
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create triggers on key tables
DROP TRIGGER IF EXISTS analytics_trigger_transactions ON transactions;
CREATE TRIGGER analytics_trigger_transactions
    AFTER INSERT OR UPDATE OR DELETE ON transactions
    FOR EACH ROW EXECUTE FUNCTION notify_analytics_event();

DROP TRIGGER IF EXISTS analytics_trigger_bookings ON bookings;
CREATE TRIGGER analytics_trigger_bookings
    AFTER INSERT OR UPDATE OR DELETE ON bookings
    FOR EACH ROW EXECUTE FUNCTION notify_analytics_event();

DROP TRIGGER IF EXISTS analytics_trigger_users ON users;
CREATE TRIGGER analytics_trigger_users
    AFTER INSERT OR UPDATE OR DELETE ON users
    FOR EACH ROW EXECUTE FUNCTION notify_analytics_event();

DROP TRIGGER IF EXISTS analytics_trigger_reviews ON reviews;
CREATE TRIGGER analytics_trigger_reviews
    AFTER INSERT OR UPDATE OR DELETE ON reviews
    FOR EACH ROW EXECUTE FUNCTION notify_analytics_event();

-- Comments for documentation
COMMENT ON TABLE analytics_predictions IS 'Cache for ML-generated predictions (revenue, demand forecasting)';
COMMENT ON TABLE user_cohorts IS 'User cohort analysis data with retention metrics';
COMMENT ON TABLE custom_reports IS 'User-defined custom analytics reports';
COMMENT ON TABLE analytics_insights IS 'Auto-generated insights and recommendations';
COMMENT ON TABLE analytics_alert_thresholds IS 'Configurable alert thresholds for metrics';
COMMENT ON TABLE dashboard_widgets IS 'User dashboard widget configurations';

COMMENT ON MATERIALIZED VIEW mv_hourly_session_demand IS 'Hourly booking patterns for demand prediction';
COMMENT ON MATERIALIZED VIEW mv_mentor_performance IS 'Comprehensive mentor performance metrics';
COMMENT ON MATERIALIZED VIEW mv_revenue_time_series IS 'Daily revenue data for forecasting models';

COMMENT ON FUNCTION refresh_advanced_analytics_views IS 'Refresh all analytics materialized views';
COMMENT ON FUNCTION notify_analytics_event IS 'Trigger function to notify analytics pipeline of data changes';