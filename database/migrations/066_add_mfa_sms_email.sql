-- Add MFA method tracking and OTP storage for SMS/email verification
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mfa_method VARCHAR(10) DEFAULT 'totp' CHECK (mfa_method IN ('totp', 'sms', 'email')),
  ADD COLUMN IF NOT EXISTS mfa_phone VARCHAR(30);

CREATE TABLE IF NOT EXISTS mfa_otp_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash VARCHAR(128) NOT NULL,
    method VARCHAR(10) NOT NULL CHECK (method IN ('sms', 'email')),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mfa_otp_user_method ON mfa_otp_codes(user_id, method, used, expires_at);
