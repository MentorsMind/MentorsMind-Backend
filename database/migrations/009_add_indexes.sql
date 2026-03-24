-- Migration: Add database indexes for common queries to optimize performance

-- Table: transactions
-- Composite index for filtering a user's transactions by status and sorting by creation date
CREATE INDEX IF NOT EXISTS idx_transactions_user_status_created 
ON transactions(user_id, status, created_at DESC);

-- Index for currency filtering/aggregation
CREATE INDEX IF NOT EXISTS idx_transactions_currency 
ON transactions(currency);

-- Table: disputes
-- Index to quickly find disputes created by a specific user
CREATE INDEX IF NOT EXISTS idx_disputes_reporter_id 
ON disputes(reporter_id);

-- Composite index to find disputes by status efficiently sorted by date
CREATE INDEX IF NOT EXISTS idx_disputes_status_created 
ON disputes(status, created_at DESC);

-- Table: audit_logs
-- Composite index to filter logs by severity level sorted by date
CREATE INDEX IF NOT EXISTS idx_audit_logs_level_created 
ON audit_logs(level, created_at DESC);

-- Index for quickly filtering audit actions by user
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_action 
ON audit_logs(user_id, action);
