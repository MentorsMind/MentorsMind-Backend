-- Migration: create password_history table
-- Stores bcrypt hashes of recent passwords to enforce PASSWORD_HISTORY_COUNT reuse prevention.

CREATE TABLE IF NOT EXISTS password_history (
    id          UUID                     NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id     UUID                     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hash        VARCHAR(255)             NOT NULL,
    created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_history_user_created
    ON password_history (user_id, created_at DESC);
