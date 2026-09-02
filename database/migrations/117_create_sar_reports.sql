-- Migration 117: Create SAR (Suspicious Activity Report) tables
-- Provides immutable audit trail and admin review queue for AML compliance

CREATE TABLE IF NOT EXISTS sar_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id        TEXT NOT NULL,
  user_id         UUID NOT NULL,
  summary         TEXT NOT NULL,
  transactions    JSONB NOT NULL DEFAULT '[]',
  risk_score      NUMERIC(10, 2) NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'pending_review'
                    CHECK (status IN ('pending_review', 'approved', 'rejected', 'submitted')),
  reviewer_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at     TIMESTAMPTZ,
  submitted_at    TIMESTAMPTZ,
  export_path     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Immutable audit log: rows are INSERT-only, never updated or deleted
CREATE TABLE IF NOT EXISTS sar_audit_log (
  id          BIGSERIAL PRIMARY KEY,
  sar_id      UUID NOT NULL REFERENCES sar_reports(id) ON DELETE CASCADE,
  action      TEXT NOT NULL,
  actor_id    UUID,
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_sar_reports_status      ON sar_reports(status);
CREATE INDEX IF NOT EXISTS idx_sar_reports_user_id     ON sar_reports(user_id);
CREATE INDEX IF NOT EXISTS idx_sar_reports_created_at  ON sar_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sar_audit_log_sar_id    ON sar_audit_log(sar_id);

-- Prevent UPDATE / DELETE on the audit log (immutability rule)
CREATE OR REPLACE RULE sar_audit_log_no_update AS
  ON UPDATE TO sar_audit_log DO INSTEAD NOTHING;

CREATE OR REPLACE RULE sar_audit_log_no_delete AS
  ON DELETE TO sar_audit_log DO INSTEAD NOTHING;
