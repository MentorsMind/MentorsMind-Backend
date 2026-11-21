-- Accelerate substring searches against mentor bios.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_users_mentor_bio_trgm
  ON users USING GIN (bio gin_trgm_ops)
  WHERE role = 'mentor';

COMMENT ON INDEX idx_users_mentor_bio_trgm IS
  'Supports substring ILIKE searches on mentor bios';
