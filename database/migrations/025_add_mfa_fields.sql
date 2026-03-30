-- Up Migration
ALTER TABLE users 
ADD COLUMN mfa_enabled BOOLEAN DEFAULT FALSE,
ADD COLUMN mfa_secret TEXT,
ADD COLUMN mfa_backup_codes TEXT[];

-- Down Migration
ALTER TABLE users 
DROP COLUMN IF EXISTS mfa_enabled,
DROP COLUMN IF EXISTS mfa_secret,
DROP COLUMN IF EXISTS mfa_backup_codes;
