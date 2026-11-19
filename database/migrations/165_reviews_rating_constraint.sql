-- =============================================================================
-- Migration: 165_reviews_rating_constraint.sql
-- Description: Enforce reviews.rating BETWEEN 1 AND 5 at the database level so
--              direct writes, seeds or migrations cannot corrupt the
--              users.average_rating aggregate (#1097).
--
--              005_create_reviews.sql adds check_rating_range and
--              001_create_users.sql adds check_average_rating, but either may
--              be missing on databases that drifted. PostgreSQL has no
--              ADD CONSTRAINT IF NOT EXISTS, so each constraint is guarded by a
--              pg_constraint lookup on both the original and new names to avoid
--              adding a duplicate CHECK.
-- =============================================================================

-- ---------------------------------------------------------------
-- reviews.rating must be 1–5
-- ---------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'reviews'::regclass
          AND conname IN ('check_rating_range', 'chk_reviews_rating')
    ) THEN
        ALTER TABLE reviews
            ADD CONSTRAINT chk_reviews_rating CHECK (rating >= 1 AND rating <= 5);
        COMMENT ON CONSTRAINT chk_reviews_rating ON reviews
            IS 'Overall rating must be between 1 and 5 stars (#1097)';
    END IF;
END $$;

-- ---------------------------------------------------------------
-- Aggregate: users.average_rating must stay within 0.00–5.00
-- (0.00 is the default for users with no reviews yet)
-- ---------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'users'::regclass
          AND conname IN ('check_average_rating', 'chk_users_average_rating')
    ) THEN
        ALTER TABLE users
            ADD CONSTRAINT chk_users_average_rating
            CHECK (average_rating >= 0 AND average_rating <= 5);
    END IF;
END $$;
