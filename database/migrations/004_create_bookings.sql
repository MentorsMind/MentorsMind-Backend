-- =============================================================================
-- Migration: 004_create_bookings.sql
-- Description: Create bookings/sessions table with payment integration
-- =============================================================================

-- Create ENUM types for bookings
CREATE TYPE booking_status AS ENUM (
    'pending',
    'confirmed',
    'in_progress',
    'completed',
    'cancelled',
    'no_show'
);

CREATE TYPE payment_status AS ENUM (
    'unpaid',
    'paid',
    'held_in_escrow',
    'released',
    'refunded',
    'disputed'
);

-- Create bookings table
CREATE TABLE IF NOT EXISTS bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Participants
    mentee_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    mentor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    
    -- Session details
    title VARCHAR(255) NOT NULL,
    description TEXT,
    session_type VARCHAR(50) DEFAULT 'video_call', -- video_call, audio_call, chat, in_person
    
    -- Scheduling
    scheduled_start TIMESTAMP WITH TIME ZONE NOT NULL,
    scheduled_end TIMESTAMP WITH TIME ZONE NOT NULL,
    duration_minutes INTEGER GENERATED ALWAYS AS (
        EXTRACT(EPOCH FROM (scheduled_end - scheduled_start)) / 60
    ) STORED,
    timezone VARCHAR(50),
    
    -- Actual timing
    actual_start TIMESTAMP WITH TIME ZONE,
    actual_end TIMESTAMP WITH TIME ZONE,
    
    -- Status
    status booking_status NOT NULL DEFAULT 'pending',
    
    -- Payment details
    payment_status payment_status NOT NULL DEFAULT 'unpaid',
    amount DECIMAL(10, 2) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'XLM',
    platform_fee DECIMAL(10, 2) NOT NULL,
    mentor_payout DECIMAL(10, 2) NOT NULL,
    
    -- Transaction references
    payment_transaction_id UUID REFERENCES transactions(id),
    payout_transaction_id UUID REFERENCES transactions(id),
    escrow_transaction_id UUID REFERENCES transactions(id),
    
    -- Meeting details
    meeting_url VARCHAR(500),
    meeting_id VARCHAR(100),
    meeting_password VARCHAR(100),
    
    -- Cancellation
    cancelled_by UUID REFERENCES users(id),
    cancelled_at TIMESTAMP WITH TIME ZONE,
    cancellation_reason TEXT,
    
    -- Completion
    completed_at TIMESTAMP WITH TIME ZONE,
    completion_notes TEXT,
    
    -- Reminders
    reminder_sent_mentee BOOLEAN DEFAULT FALSE,
    reminder_sent_mentor BOOLEAN DEFAULT FALSE,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'::jsonb,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create booking_participants table for group sessions (future expansion)
CREATE TABLE IF NOT EXISTS booking_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Booking relationship
    booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    
    -- Participant
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL, -- mentor, mentee, observer
    
    -- Participation
    joined_at TIMESTAMP WITH TIME ZONE,
    left_at TIMESTAMP WITH TIME ZONE,
    attendance_status VARCHAR(20) DEFAULT 'pending', -- pending, attended, absent
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Unique constraint
    UNIQUE(booking_id, user_id)
);

-- Create booking_notes table for session notes
CREATE TABLE IF NOT EXISTS booking_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Booking relationship
    booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    
    -- Author
    author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Note content
    content TEXT NOT NULL,
    is_private BOOLEAN DEFAULT FALSE, -- Private notes only visible to author
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for bookings
CREATE INDEX idx_bookings_mentee_id ON bookings(mentee_id);
CREATE INDEX idx_bookings_mentor_id ON bookings(mentor_id);
CREATE INDEX idx_bookings_status ON bookings(status);
CREATE INDEX idx_bookings_payment_status ON bookings(payment_status);
CREATE INDEX idx_bookings_scheduled_start ON bookings(scheduled_start);
CREATE INDEX idx_bookings_scheduled_end ON bookings(scheduled_end);
CREATE INDEX idx_bookings_created_at ON bookings(created_at);
CREATE INDEX idx_bookings_mentor_upcoming ON bookings(mentor_id, scheduled_start) 
    WHERE status IN ('pending', 'confirmed') AND scheduled_start > NOW();
CREATE INDEX idx_bookings_mentee_upcoming ON bookings(mentee_id, scheduled_start) 
    WHERE status IN ('pending', 'confirmed') AND scheduled_start > NOW();

-- Create indexes for booking_participants
CREATE INDEX idx_booking_participants_booking_id ON booking_participants(booking_id);
CREATE INDEX idx_booking_participants_user_id ON booking_participants(user_id);

-- Create indexes for booking_notes
CREATE INDEX idx_booking_notes_booking_id ON booking_notes(booking_id);
CREATE INDEX idx_booking_notes_author_id ON booking_notes(author_id);

-- Add constraints
ALTER TABLE bookings ADD CONSTRAINT check_mentee_not_mentor CHECK (mentee_id != mentor_id);
ALTER TABLE bookings ADD CONSTRAINT check_scheduled_times CHECK (scheduled_end > scheduled_start);
ALTER TABLE bookings ADD CONSTRAINT check_amount_positive CHECK (amount > 0);
ALTER TABLE bookings ADD CONSTRAINT check_fees_valid CHECK (
    platform_fee >= 0 AND 
    mentor_payout >= 0 AND 
    (platform_fee + mentor_payout) <= amount
);

-- Add comments
COMMENT ON TABLE bookings IS 'Mentorship session bookings with payment integration';
COMMENT ON TABLE booking_participants IS 'Participants in booking sessions (supports group sessions)';
COMMENT ON TABLE booking_notes IS 'Session notes created by mentors or mentees';
COMMENT ON COLUMN bookings.duration_minutes IS 'Computed column: session duration in minutes';
COMMENT ON COLUMN bookings.escrow_transaction_id IS 'Transaction ID for funds held in escrow until session completion';
