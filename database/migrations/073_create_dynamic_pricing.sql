-- Migration: 073_create_dynamic_pricing
-- Adds dynamic pricing engine tables for market analysis, benchmarks, and A/B testing

-- Pricing experiments table (A/B testing)
CREATE TABLE IF NOT EXISTS pricing_experiments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'running', 'paused', 'completed', 'cancelled')),
  start_at        TIMESTAMP WITH TIME ZONE,
  end_at          TIMESTAMP WITH TIME ZONE,
  control_price   NUMERIC(10, 2) NOT NULL,
  variant_prices  JSONB NOT NULL DEFAULT '[]',         -- [{label, price, sessions_booked, revenue}]
  metrics         JSONB DEFAULT '{}',                   -- {control_sessions, variant_sessions, conversion_lift, confidence}
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Pricing benchmarks table
CREATE TABLE IF NOT EXISTS pricing_benchmarks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category        TEXT NOT NULL,                         -- e.g. 'technology', 'business', 'arts'
  subcategory     TEXT,
  skill           TEXT NOT NULL,
  p10_price       NUMERIC(10, 2),
  p25_price       NUMERIC(10, 2),
  p50_price       NUMERIC(10, 2),                       -- median
  p75_price       NUMERIC(10, 2),
  p90_price       NUMERIC(10, 2),
  avg_price       NUMERIC(10, 2),
  min_price       NUMERIC(10, 2),
  max_price       NUMERIC(10, 2),
  sample_size     INTEGER NOT NULL DEFAULT 0,
  currency        TEXT NOT NULL DEFAULT 'USD',
  computed_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Market demand metrics table
CREATE TABLE IF NOT EXISTS market_demand_metrics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill           TEXT NOT NULL,
  category        TEXT,
  period          TEXT NOT NULL,                         -- 'daily', 'weekly', 'monthly'
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  search_count    INTEGER NOT NULL DEFAULT 0,
  booking_count   INTEGER NOT NULL DEFAULT 0,
  mentor_count    INTEGER NOT NULL DEFAULT 0,
  avg_session_price NUMERIC(10, 2),
  total_revenue   NUMERIC(12, 2),
  demand_score    NUMERIC(5, 2),                        -- 0.00 - 100.00
  supply_score    NUMERIC(5, 2),                        -- 0.00 - 100.00
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(skill, period, period_start)
);

-- Pricing recommendations log
CREATE TABLE IF NOT EXISTS pricing_recommendations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  current_price   NUMERIC(10, 2) NOT NULL,
  recommended_price NUMERIC(10, 2) NOT NULL,
  confidence      NUMERIC(5, 2),                        -- 0.00 - 100.00
  market_position TEXT,                                  -- 'below_market', 'at_market', 'above_market'
  factors         JSONB DEFAULT '[]',                   -- [{factor, impact}]
  reason          TEXT,
  applied         BOOLEAN NOT NULL DEFAULT false,
  applied_at      TIMESTAMP WITH TIME ZONE,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_pricing_experiments_mentor ON pricing_experiments(mentor_id);
CREATE INDEX IF NOT EXISTS idx_pricing_experiments_status ON pricing_experiments(status);
CREATE INDEX IF NOT EXISTS idx_pricing_benchmarks_category ON pricing_benchmarks(category, skill);
CREATE INDEX IF NOT EXISTS idx_pricing_benchmarks_skill ON pricing_benchmarks(skill);
CREATE INDEX IF NOT EXISTS idx_market_demand_metrics_skill ON market_demand_metrics(skill);
CREATE INDEX IF NOT EXISTS idx_market_demand_metrics_period ON market_demand_metrics(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_pricing_recommendations_mentor ON pricing_recommendations(mentor_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_pricing_experiments_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pricing_experiments_updated_at ON pricing_experiments;
CREATE TRIGGER trg_pricing_experiments_updated_at
  BEFORE UPDATE ON pricing_experiments
  FOR EACH ROW EXECUTE FUNCTION update_pricing_experiments_updated_at();
