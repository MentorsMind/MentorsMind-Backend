-- Preserve append-only audit history while allowing account deletion to remove
-- direct identifiers. The original record hash and chain links are retained;
-- redacted records are marked so the application can skip content HMAC checks.
CREATE OR REPLACE FUNCTION prevent_audit_log_modification()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF OLD.user_id IS NOT NULL
           AND NEW.user_id IS NULL
           AND NEW.ip_address IS NULL
           AND NEW.user_agent IS NULL
           AND NEW.hash_algorithm = 'hmac-sha256-redacted'
           AND jsonb_object_length(NEW.metadata) = 2
           AND NEW.metadata->>'anonymizedUserId' ~ '^[0-9a-f]{64}$'
           AND NEW.metadata->>'anonymizedUserId' =
               encode(digest('audit-log-user:' || OLD.user_id::text, 'sha256'), 'hex')
           AND NEW.metadata->>'anonymizedAt' IS NOT NULL
           AND (to_jsonb(NEW) - ARRAY[
                 'user_id', 'ip_address', 'user_agent', 'metadata',
                 'hash_algorithm'
               ]::text[])
               IS NOT DISTINCT FROM
               (to_jsonb(OLD) - ARRAY[
                 'user_id', 'ip_address', 'user_agent', 'metadata',
                 'hash_algorithm'
               ]::text[])
        THEN
            RETURN NEW;
        END IF;

        RAISE EXCEPTION 'Audit logs are immutable except for account anonymization';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Audit logs are immutable and cannot be deleted';
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
