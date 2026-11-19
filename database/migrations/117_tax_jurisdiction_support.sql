-- =============================================================================
-- Migration: 117_tax_jurisdiction_support.sql
-- Description: Multi-jurisdiction tax reporting — jurisdiction column, per-year
--              export generation state, and per-country tax rate overrides.
-- =============================================================================

-- Jurisdiction the report was generated under (US | EU | UK).
ALTER TABLE tax_reports
  ADD COLUMN IF NOT EXISTS jurisdiction TEXT,
  ADD COLUMN IF NOT EXISTS country_code TEXT,
  ADD COLUMN IF NOT EXISTS vat_rate NUMERIC(6, 4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_exported_at TIMESTAMPTZ;

-- Per-jurisdiction report override table (configurable rules per country).
CREATE TABLE IF NOT EXISTS tax_jurisdiction_config (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction    TEXT NOT NULL,                 -- 'US' | 'EU' | 'UK'
  country_code    TEXT NOT NULL,                 -- ISO 3166-1 alpha-2
  tax_rate        NUMERIC(6, 4) NOT NULL DEFAULT 0,
  export_format   TEXT NOT NULL,                 -- '1099K_CSV' | 'VAT_SUMMARY' | 'MTD_XML'
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (jurisdiction, country_code)
);

CREATE INDEX IF NOT EXISTS idx_tax_reports_jurisdiction ON tax_reports (jurisdiction);
CREATE INDEX IF NOT EXISTS idx_tax_jurisdiction_config_country ON tax_jurisdiction_config (country_code);

-- Default jurisdiction config seed rows.
INSERT INTO tax_jurisdiction_config (jurisdiction, country_code, tax_rate, export_format) VALUES
  ('US', 'US', 0, '1099K_CSV'),
  ('US', 'PR', 0, '1099K_CSV'),
  ('EU', 'DE', 0.19, 'VAT_SUMMARY'),
  ('EU', 'FR', 0.20, 'VAT_SUMMARY'),
  ('UK', 'GB', 0.20, 'MTD_XML')
ON CONFLICT (jurisdiction, country_code) DO NOTHING;
