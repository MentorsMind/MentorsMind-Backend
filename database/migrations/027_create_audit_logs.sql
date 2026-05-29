-- =============================================================================
-- Migration: 027_create_audit_logs.sql
-- Description: Create audit_logs table for immutable security and compliance logging
-- =============================================================================

-- Create audit_logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- User who performed the action (nullable for system actions)
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    
    -- Action details
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id VARCHAR(255),
    
    -- Request context
    ip_address VARCHAR(45), -- Supports IPv6
    user_agent TEXT,
    
    -- Additional metadata (flexible JSON storage)
    metadata JSONB DEFAULT '{}'::jsonb,
    
    -- Timestamp (immutable, no updates allowed)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for common query patterns
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_resource_type ON audit_logs(resource_type);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX idx_audit_logs_user_action ON audit_logs(user_id, action);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);

-- Add comments for documentation
COMMENT ON TABLE audit_logs IS 'Immutable audit log for security-sensitive and data-changing actions';
COMMENT ON COLUMN audit_logs.user_id IS 'User who performed the action (NULL for system actions)';
COMMENT ON COLUMN audit_logs.action IS 'Action type (e.g., LOGIN, LOGOUT, PASSWORD_CHANGE, etc.)';
COMMENT ON COLUMN audit_logs.resource_type IS 'Type of resource affected (e.g., user, booking, payment)';
COMMENT ON COLUMN audit_logs.resource_id IS 'ID of the resource affected';
COMMENT ON COLUMN audit_logs.metadata IS 'Additional context data in JSON format';
COMMENT ON COLUMN audit_logs.created_at IS 'Timestamp when the action occurred (immutable)';

-- Prevent updates and deletes on audit_logs (immutable)
-- This is enforced at the application level and via database permissions
-- In production, consider using database-level triggers to prevent UPDATE/DELETE
