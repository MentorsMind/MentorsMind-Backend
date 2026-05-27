-- Migration: 058_add_user_tier
-- Adds user_tier column to users table for tiered rate limiting

DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_tier_enum') THEN
        CREATE TYPE user_tier_enum AS ENUM ('free', 'pro', 'enterprise');
    END IF;
END $$;

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS user_tier user_tier_enum NOT NULL DEFAULT 'free';

CREATE INDEX IF NOT EXISTS idx_users_user_tier ON users(user_tier);
