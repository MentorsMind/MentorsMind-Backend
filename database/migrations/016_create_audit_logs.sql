-- =============================================================================
-- Migration: 016_create_audit_logs.sql
-- Description: Enhanced tamper-evident audit log with compliance features
-- =============================================================================

-- Drop existing audit_logs table if it exists (for clean migration)
DROP TABLE IF EXISTS audit_logs CASCADE;

-- Create enhanced audit_logs table with tamper-evident features
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- User and action tracking
    user_id UUID REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    
    -- Resource tracking
    resource_type VARCHAR(100) NOT NULL,
    resource_id VARCHAR(255),
    
    -- Change tracking (for data modifications)
    old_value JSONB,
    new_value JSONB,
    
    -- Request context
    ip_address VARCHAR(45),
    user_agent TEXT,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'::jsonb,
    
    -- Timestamp (immutable)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    
    -- Tamper-evident hash chain (optional enhancement)
    previous_hash VARCHAR(64),
    record_hash VARCHAR(64)
);

-- Create indexes for efficient querying
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_user_action ON audit_logs(user_id, action);

-- Prevent UPDATE and DELETE operations (append-only enforcement)
CREATE OR REPLACE FUNCTION prevent_audit_log_modification()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'Audit logs are immutable and cannot be updated';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Audit logs are immutable and cannot be deleted';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_audit_log_update
    BEFORE UPDATE ON audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION prevent_audit_log_modification();

CREATE TRIGGER trg_prevent_audit_log_delete
    BEFORE DELETE ON audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION prevent_audit_log_modification();

-- Function to compute hash for tamper detection (optional)
CREATE OR REPLACE FUNCTION compute_audit_log_hash(
    p_user_id UUID,
    p_action VARCHAR,
    p_resource_type VARCHAR,
    p_resource_id VARCHAR,
    p_old_value JSONB,
    p_new_value JSONB,
    p_created_at TIMESTAMP WITH TIME ZONE,
    p_previous_hash VARCHAR
)
RETURNS VARCHAR AS $$
BEGIN
    RETURN encode(
        digest(
            COALESCE(p_user_id::TEXT, '') || '|' ||
            p_action || '|' ||
            p_resource_type || '|' ||
            COALESCE(p_resource_id, '') || '|' ||
            COALESCE(p_old_value::TEXT, '') || '|' ||
            COALESCE(p_new_value::TEXT, '') || '|' ||
            p_created_at::TEXT || '|' ||
            COALESCE(p_previous_hash, ''),
            'sha256'
        ),
        'hex'
    );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Trigger to automatically compute hash on insert
CREATE OR REPLACE FUNCTION set_audit_log_hash()
RETURNS TRIGGER AS $$
DECLARE
    v_previous_hash VARCHAR(64);
BEGIN
    -- Get the hash of the most recent audit log
    SELECT record_hash INTO v_previous_hash
    FROM audit_logs
    ORDER BY created_at DESC, id DESC
    LIMIT 1;
    
    -- Compute hash for this record
    NEW.previous_hash := v_previous_hash;
    NEW.record_hash := compute_audit_log_hash(
        NEW.user_id,
        NEW.action,
        NEW.resource_type,
        NEW.resource_id,
        NEW.old_value,
        NEW.new_value,
        NEW.created_at,
        v_previous_hash
    );
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_set_audit_log_hash
    BEFORE INSERT ON audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION set_audit_log_hash();

-- Retention policy: Partition by year for efficient archival
-- Note: Actual partitioning would be implemented based on production needs
-- For now, we add a comment to indicate the 2-year retention requirement
COMMENT ON TABLE audit_logs IS 'Tamper-evident audit log with 2-year minimum retention. Append-only, no updates or deletes allowed.';
COMMENT ON COLUMN audit_logs.old_value IS 'Previous state of the resource (for data modifications)';
COMMENT ON COLUMN audit_logs.new_value IS 'New state of the resource (for data modifications)';
COMMENT ON COLUMN audit_logs.record_hash IS 'SHA-256 hash of record for tamper detection';
COMMENT ON COLUMN audit_logs.previous_hash IS 'Hash of previous record for chain integrity';

-- Create a view for easy audit log querying with user details
CREATE OR REPLACE VIEW v_audit_logs_with_user AS
SELECT 
    al.id,
    al.user_id,
    u.email as user_email,
    u.full_name as user_name,
    u.role as user_role,
    al.action,
    al.resource_type,
    al.resource_id,
    al.old_value,
    al.new_value,
    al.ip_address,
    al.user_agent,
    al.metadata,
    al.created_at,
    al.record_hash,
    al.previous_hash
FROM audit_logs al
LEFT JOIN users u ON al.user_id = u.id
ORDER BY al.created_at DESC;

COMMENT ON VIEW v_audit_logs_with_user IS 'Audit logs enriched with user information for reporting';
