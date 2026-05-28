-- Migration: 066_create_tax_reporting
-- Tax reporting tables for 1099 generation and mentor earnings tracking

CREATE TABLE IF NOT EXISTS tax_reports (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tax_year             SMALLINT NOT NULL,
  total_earnings       NUMERIC(14, 2) NOT NULL DEFAULT 0,
  platform_fees        NUMERIC(14, 2) NOT NULL DEFAULT 0,
  net_earnings         NUMERIC(14, 2) NOT NULL DEFAULT 0,
  form_1099_generated  BOOLEAN NOT NULL DEFAULT FALSE,
  w9_on_file           BOOLEAN NOT NULL DEFAULT FALSE,
  withholding_amount   NUMERIC(14, 2) NOT NULL DEFAULT 0,
  is_international     BOOLEAN NOT NULL DEFAULT FALSE,
  generated_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (mentor_id, tax_year)
);

CREATE TABLE IF NOT EXISTS tax_documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_report_id UUID NOT NULL REFERENCES tax_reports(id) ON DELETE CASCADE,
  mentor_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,   -- '1099-MISC', '1099-NEC', 'W-9'
  tax_year      SMALLINT NOT NULL,
  file_url      TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | generated | sent | acknowledged
  sent_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mentor_tax_info (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id       UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  tax_id_type     TEXT,          -- 'SSN', 'EIN', 'ITIN', 'FOREIGN'
  tax_id_last4    TEXT,          -- last 4 digits only (never store full)
  is_international BOOLEAN NOT NULL DEFAULT FALSE,
  country_code    TEXT,
  w9_submitted_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tax_reports_mentor_id  ON tax_reports(mentor_id);
CREATE INDEX IF NOT EXISTS idx_tax_reports_tax_year   ON tax_reports(tax_year);
CREATE INDEX IF NOT EXISTS idx_tax_documents_mentor   ON tax_documents(mentor_id);
CREATE INDEX IF NOT EXISTS idx_tax_documents_report   ON tax_documents(tax_report_id);
