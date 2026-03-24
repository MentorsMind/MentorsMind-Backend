-- =============================================================================
-- Migration: 007_create_triggers.sql
-- Description: Database triggers for auto-timestamps and business logic
-- =============================================================================

-- ============================================================================
-- Function: Update updated_at timestamp
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Apply updated_at triggers to all relevant tables
-- ============================================================================

-- Users table
CREATE TRIGGER trigger_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Wallets table
CREATE TRIGGER trigger_wallets_updated_at
    BEFORE UPDATE ON wallets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Wallet balances table
CREATE TRIGGER trigger_wallet_balances_updated_at
    BEFORE UPDATE ON wallet_balances
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Transactions table
CREATE TRIGGER trigger_transactions_updated_at
    BEFORE UPDATE ON transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Bookings table
CREATE TRIGGER trigger_bookings_updated_at
    BEFORE UPDATE ON bookings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Reviews table
CREATE TRIGGER trigger_reviews_updated_at
    BEFORE UPDATE ON reviews
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Review reports table
CREATE TRIGGER trigger_review_reports_updated_at
    BEFORE UPDATE ON review_reports
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Booking notes table
CREATE TRIGGER trigger_booking_notes_updated_at
    BEFORE UPDATE ON booking_notes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Disputes table
CREATE TRIGGER trigger_disputes_updated_at
    BEFORE UPDATE ON disputes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Function: Update user statistics on review creation
-- ============================================================================

CREATE OR REPLACE FUNCTION update_user_rating_stats()
RETURNS TRIGGER AS $$
BEGIN
    -- Update reviewee's rating statistics
    UPDATE users
    SET 
        total_reviews = (
            SELECT COUNT(*) 
            FROM reviews 
            WHERE reviewee_id = NEW.reviewee_id AND is_published = TRUE
        ),
        average_rating = (
            SELECT ROUND(AVG(rating)::numeric, 2)
            FROM reviews 
            WHERE reviewee_id = NEW.reviewee_id AND is_published = TRUE
        )
    WHERE id = NEW.reviewee_id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for new reviews
CREATE TRIGGER trigger_review_update_stats
    AFTER INSERT OR UPDATE OF rating, is_published ON reviews
    FOR EACH ROW
    WHEN (NEW.is_published = TRUE)
    EXECUTE FUNCTION update_user_rating_stats();

-- ============================================================================
-- Function: Update review helpful counts
-- ============================================================================

CREATE OR REPLACE FUNCTION update_review_helpful_counts()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.is_helpful THEN
            UPDATE reviews SET helpful_count = helpful_count + 1 WHERE id = NEW.review_id;
        ELSE
            UPDATE reviews SET not_helpful_count = not_helpful_count + 1 WHERE id = NEW.review_id;
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.is_helpful != NEW.is_helpful THEN
            IF NEW.is_helpful THEN
                UPDATE reviews 
                SET helpful_count = helpful_count + 1, not_helpful_count = not_helpful_count - 1 
                WHERE id = NEW.review_id;
            ELSE
                UPDATE reviews 
                SET helpful_count = helpful_count - 1, not_helpful_count = not_helpful_count + 1 
                WHERE id = NEW.review_id;
            END IF;
        END IF;
    ELSIF TG_OP = 'DELETE' THEN
        IF OLD.is_helpful THEN
            UPDATE reviews SET helpful_count = helpful_count - 1 WHERE id = OLD.review_id;
        ELSE
            UPDATE reviews SET not_helpful_count = not_helpful_count - 1 WHERE id = OLD.review_id;
        END IF;
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Trigger for review votes
CREATE TRIGGER trigger_review_votes_update_counts
    AFTER INSERT OR UPDATE OR DELETE ON review_votes
    FOR EACH ROW
    EXECUTE FUNCTION update_review_helpful_counts();

-- ============================================================================
-- Function: Update user session completion count
-- ============================================================================

CREATE OR REPLACE FUNCTION update_user_session_count()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
        -- Increment for both mentor and mentee
        UPDATE users 
        SET total_sessions_completed = total_sessions_completed + 1
        WHERE id IN (NEW.mentor_id, NEW.mentee_id);
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for booking completion
CREATE TRIGGER trigger_booking_completion_stats
    AFTER UPDATE OF status ON bookings
    FOR EACH ROW
    WHEN (NEW.status = 'completed')
    EXECUTE FUNCTION update_user_session_count();

-- ============================================================================
-- Function: Create transaction event on status change
-- ============================================================================

CREATE OR REPLACE FUNCTION log_transaction_status_change()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO transaction_events (
            transaction_id,
            event_type,
            old_status,
            new_status,
            description,
            metadata
        ) VALUES (
            NEW.id,
            'status_change',
            OLD.status,
            NEW.status,
            'Transaction status changed from ' || OLD.status || ' to ' || NEW.status,
            jsonb_build_object(
                'old_status', OLD.status,
                'new_status', NEW.status,
                'changed_at', NOW()
            )
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for transaction status changes
CREATE TRIGGER trigger_transaction_status_change
    AFTER UPDATE OF status ON transactions
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION log_transaction_status_change();

-- ============================================================================
-- Function: Validate booking time constraints
-- ============================================================================

CREATE OR REPLACE FUNCTION validate_booking_times()
RETURNS TRIGGER AS $$
BEGIN
    -- Ensure scheduled_end is after scheduled_start
    IF NEW.scheduled_end <= NEW.scheduled_start THEN
        RAISE EXCEPTION 'Booking end time must be after start time';
    END IF;
    
    -- Ensure booking is not in the past (for new bookings)
    IF TG_OP = 'INSERT' AND NEW.scheduled_start < NOW() THEN
        RAISE EXCEPTION 'Cannot create booking in the past';
    END IF;
    
    -- Check for overlapping bookings for the mentor
    IF EXISTS (
        SELECT 1 FROM bookings
        WHERE mentor_id = NEW.mentor_id
        AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
        AND status IN ('pending', 'confirmed', 'in_progress')
        AND (
            (NEW.scheduled_start >= scheduled_start AND NEW.scheduled_start < scheduled_end)
            OR (NEW.scheduled_end > scheduled_start AND NEW.scheduled_end <= scheduled_end)
            OR (NEW.scheduled_start <= scheduled_start AND NEW.scheduled_end >= scheduled_end)
        )
    ) THEN
        RAISE EXCEPTION 'Mentor has overlapping booking at this time';
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for booking validation
CREATE TRIGGER trigger_validate_booking_times
    BEFORE INSERT OR UPDATE OF scheduled_start, scheduled_end ON bookings
    FOR EACH ROW
    EXECUTE FUNCTION validate_booking_times();

-- ============================================================================
-- Function: Set transaction timestamps based on status
-- ============================================================================

CREATE OR REPLACE FUNCTION set_transaction_timestamps()
RETURNS TRIGGER AS $$
BEGIN
    -- Set processed_at when status changes to processing
    IF NEW.status = 'processing' AND OLD.status != 'processing' THEN
        NEW.processed_at = NOW();
    END IF;
    
    -- Set completed_at when status changes to completed
    IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
        NEW.completed_at = NOW();
    END IF;
    
    -- Set failed_at when status changes to failed
    IF NEW.status = 'failed' AND OLD.status != 'failed' THEN
        NEW.failed_at = NOW();
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for transaction timestamps
CREATE TRIGGER trigger_transaction_timestamps
    BEFORE UPDATE OF status ON transactions
    FOR EACH ROW
    EXECUTE FUNCTION set_transaction_timestamps();

-- ============================================================================
-- Function: Set booking completion timestamp
-- ============================================================================

CREATE OR REPLACE FUNCTION set_booking_completion_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
        NEW.completed_at = NOW();
    END IF;
    
    IF NEW.status = 'cancelled' AND (OLD.status IS NULL OR OLD.status != 'cancelled') THEN
        NEW.cancelled_at = NOW();
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for booking completion
CREATE TRIGGER trigger_booking_completion_timestamp
    BEFORE UPDATE OF status ON bookings
    FOR EACH ROW
    EXECUTE FUNCTION set_booking_completion_timestamp();

-- Add comments
COMMENT ON FUNCTION update_updated_at_column() IS 'Automatically updates the updated_at timestamp on row modification';
COMMENT ON FUNCTION update_user_rating_stats() IS 'Recalculates user average rating and review count when reviews change';
COMMENT ON FUNCTION update_review_helpful_counts() IS 'Updates helpful/not helpful counts on reviews when votes change';
COMMENT ON FUNCTION update_user_session_count() IS 'Increments session completion count for users';
COMMENT ON FUNCTION log_transaction_status_change() IS 'Creates audit log entry when transaction status changes';
COMMENT ON FUNCTION validate_booking_times() IS 'Validates booking time constraints and prevents overlapping bookings';
COMMENT ON FUNCTION set_transaction_timestamps() IS 'Automatically sets transaction timestamps based on status changes';
COMMENT ON FUNCTION set_booking_completion_timestamp() IS 'Sets completion/cancellation timestamps on bookings';
