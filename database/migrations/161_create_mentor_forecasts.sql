-- =============================================================================
-- Migration: 161_create_mentor_forecasts.sql
-- Description: Create mentor_forecasts table for persisting earnings forecast data
-- =============================================================================

-- Create ENUM type for forecast period
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'forecast_period') THEN
    CREATE TYPE forecast_period AS ENUM ('monthly', 'quarterly', 'yearly');
  END IF;
END$$;

-- Create mentor_forecasts table
CREATE TABLE IF NOT EXISTS mentor_forecasts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Mentor reference
    mentor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Forecast period (monthly, quarterly, yearly)
    period forecast_period NOT NULL,

    -- When this forecast was generated
    generated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    -- Forecast scenarios
    scenario_pessimistic DECIMAL(20, 2) NOT NULL DEFAULT 0,
    scenario_realistic   DECIMAL(20, 2) NOT NULL DEFAULT 0,
    scenario_optimistic  DECIMAL(20, 2) NOT NULL DEFAULT 0,

    -- Confidence score (0.0 – 1.0)
    confidence DECIMAL(4, 3) NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),

    -- Full forecast JSON payload (ForecastPoint[] + assumptions)
    forecast_data JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Number of historical data points used to build this forecast
    historical_months INTEGER NOT NULL DEFAULT 0,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_mentor_forecasts_mentor_id      ON mentor_forecasts(mentor_id);
CREATE INDEX idx_mentor_forecasts_period         ON mentor_forecasts(period);
CREATE INDEX idx_mentor_forecasts_generated_at   ON mentor_forecasts(generated_at DESC);
-- Composite index used by "latest forecast" query
CREATE INDEX idx_mentor_forecasts_mentor_period  ON mentor_forecasts(mentor_id, period, generated_at DESC);

-- Comments
COMMENT ON TABLE  mentor_forecasts                       IS 'Persisted earnings forecasts for mentors, keyed by (mentor_id, period, generated_at)';
COMMENT ON COLUMN mentor_forecasts.mentor_id             IS 'Reference to the mentor user';
COMMENT ON COLUMN mentor_forecasts.period                IS 'Forecast horizon: monthly, quarterly, or yearly';
COMMENT ON COLUMN mentor_forecasts.generated_at          IS 'Timestamp when this forecast snapshot was created';
COMMENT ON COLUMN mentor_forecasts.scenario_pessimistic  IS 'Pessimistic scenario total earnings for the period';
COMMENT ON COLUMN mentor_forecasts.scenario_realistic    IS 'Realistic scenario total earnings for the period';
COMMENT ON COLUMN mentor_forecasts.scenario_optimistic   IS 'Optimistic scenario total earnings for the period';
COMMENT ON COLUMN mentor_forecasts.confidence            IS 'Model confidence score between 0.0 and 1.0';
COMMENT ON COLUMN mentor_forecasts.forecast_data         IS 'Full serialised ForecastPoint array plus assumptions';
COMMENT ON COLUMN mentor_forecasts.historical_months     IS 'Number of historical months of data used for this forecast';
