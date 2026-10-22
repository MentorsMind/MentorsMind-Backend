ALTER TABLE sessions_archive
  ADD COLUMN IF NOT EXISTS tenant_id UUID;
