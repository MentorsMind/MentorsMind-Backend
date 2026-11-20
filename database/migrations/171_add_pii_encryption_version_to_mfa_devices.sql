-- Add pii_encryption_version column to mfa_devices for TOTP secret re-encryption tracking
-- This enables the re-encryption job to track which MFA devices have been migrated to the new encryption key

ALTER TABLE mfa_devices 
ADD COLUMN IF NOT EXISTS pii_encryption_version VARCHAR(10);

-- Create index for the re-encryption job query
CREATE INDEX IF NOT EXISTS idx_mfa_devices_encryption_version 
ON mfa_devices(type, pii_encryption_version) 
WHERE type = 'totp' AND encrypted_secret IS NOT NULL;

-- Update existing TOTP devices to mark them as needing re-encryption
-- (they will be NULL by default, which signals old key version)
COMMENT ON COLUMN mfa_devices.pii_encryption_version IS 
'Tracks the encryption key version used for encrypted_secret. NULL or older versions trigger re-encryption in the scheduled job.';
