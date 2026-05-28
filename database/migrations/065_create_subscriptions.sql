-- Migration: 065_create_subscriptions
-- Adds subscription tiers with billing, trial, and feature management

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_tier_enum') THEN
    CREATE TYPE subscription_tier_enum AS ENUM ('free', 'pro', 'premium', 'enterprise');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_status_enum') THEN
    CREATE TYPE subscription_status_enum AS ENUM ('active', 'cancelled', 'expired', 'trial');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_cycle_enum') THEN
    CREATE TYPE billing_cycle_enum AS ENUM ('monthly', 'yearly');
  END IF;
END $$;

-- Extend user_tier_enum to include premium if not already present
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'premium' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'user_tier_enum')) THEN
    ALTER TYPE user_tier_enum ADD VALUE 'premium';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS subscriptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tier          subscription_tier_enum NOT NULL DEFAULT 'free',
  status        subscription_status_enum NOT NULL DEFAULT 'active',
  billing_cycle billing_cycle_enum NOT NULL DEFAULT 'monthly',
  price         NUMERIC(10, 2) NOT NULL DEFAULT 0,
  features      TEXT[] NOT NULL DEFAULT '{}',
  start_date    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_date      TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,
  auto_renew    BOOLEAN NOT NULL DEFAULT TRUE,
  stellar_tx_id TEXT,
  cancelled_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status  ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_tier    ON subscriptions(tier);
CREATE INDEX IF NOT EXISTS idx_subscriptions_end_date ON subscriptions(end_date) WHERE end_date IS NOT NULL;
