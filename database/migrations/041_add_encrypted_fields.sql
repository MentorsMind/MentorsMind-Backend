ALTER TABLE users
    ADD COLUMN IF NOT EXISTS phone_number_encrypted TEXT,
    ADD COLUMN IF NOT EXISTS date_of_birth_encrypted TEXT,
    ADD COLUMN IF NOT EXISTS government_id_number_encrypted TEXT,
    ADD COLUMN IF NOT EXISTS bank_account_details_encrypted TEXT,
    ADD COLUMN IF NOT EXISTS pii_encryption_version VARCHAR(32);

CREATE INDEX IF NOT EXISTS idx_users_pii_encryption_version
    ON users(pii_encryption_version)
    WHERE pii_encryption_version IS NOT NULL;
