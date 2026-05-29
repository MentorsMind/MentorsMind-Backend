-- Add revocation_reason column to refresh_tokens
-- Distinguishes between manual logout, session limit enforcement, and theft detection

ALTER TABLE refresh_tokens
  ADD COLUMN IF NOT EXISTS revocation_reason VARCHAR(50);

-- Allowed values: 'logout', 'session_limit', 'theft_detected', 'expired'
COMMENT ON COLUMN refresh_tokens.revocation_reason IS
  'Reason a token was revoked: logout | session_limit | theft_detected | expired';
