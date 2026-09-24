-- =============================================================================
-- Migration: 164_add_tenant_id_to_audit_logs.sql
-- Description: Add tenant_id to audit_logs so tenant-scoped operations can be
--              filtered efficiently by tenant (issue #1076) instead of relying
--              on expensive JSONB searches through the metadata column.
--
-- Notes
-- ─────
-- 1. Nullable: system/background jobs (workers, health checks) have no tenant
--    context and store NULL.
-- 2. tenant_id is intentionally NOT part of the HMAC hash-chain canonical
--    form, so existing audit-log entries remain verifiable after this change.
-- 3. A partial index supports per-tenant compliance reporting lookups.
-- =============================================================================

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_id ON audit_logs(tenant_id)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_action ON audit_logs(tenant_id, action)
  WHERE tenant_id IS NOT NULL;

COMMENT ON COLUMN audit_logs.tenant_id IS
  'Multi-tenant isolation: owning tenant UUID (NULL = system/shared entry)';
