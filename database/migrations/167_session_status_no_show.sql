-- Add 'no_show' as a valid session status (issue #1273).
-- Sessions are created with a VARCHAR status guarded by a CHECK constraint;
-- deployments that use a native session_status enum get the enum value instead.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'session_status') THEN
    ALTER TYPE session_status ADD VALUE IF NOT EXISTS 'no_show';
  END IF;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

DO $$
DECLARE
  con RECORD;
BEGIN
  FOR con IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'sessions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
      AND pg_get_constraintdef(oid) NOT ILIKE '%no_show%'
      AND pg_get_constraintdef(oid) ILIKE '%confirmed%'
  LOOP
    EXECUTE format('ALTER TABLE sessions DROP CONSTRAINT %I', con.conname);
    ALTER TABLE sessions ADD CONSTRAINT sessions_status_check
      CHECK (status IN ('pending', 'confirmed', 'scheduled', 'completed', 'cancelled', 'no_show'));
  END LOOP;
END $$;
