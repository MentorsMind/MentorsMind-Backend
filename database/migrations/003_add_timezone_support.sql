-- Migration: Add Timezone Support
-- Description: Add timezone columns and session reminder tracking
-- Date: 2026-03-24

-- Add timezone column to users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) DEFAULT 'UTC';

-- Add constraint to validate IANA timezone format
ALTER TABLE users
ADD CONSTRAINT IF NOT EXISTS valid_timezone 
CHECK (timezone ~ '^[A-Za-z_]+/[A-Za-z_]+$' OR timezone = 'UTC' OR timezone = 'Etc/UTC');

-- Create sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mentee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scheduled_at_utc TIMESTAMP WITH TIME ZONE NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0 AND duration_minutes <= 480),
  topic VARCHAR(255),
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled', 'no_show')),
  meeting_link VARCHAR(500),
  reminded_24h TIMESTAMP WITH TIME ZONE,
  reminded_1h TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT different_users CHECK (mentor_id != mentee_id)
);

-- Create indexes for sessions table
CREATE INDEX IF NOT EXISTS idx_sessions_scheduled_at ON sessions(scheduled_at_utc);
CREATE INDEX IF NOT EXISTS idx_sessions_mentor_id ON sessions(mentor_id);
CREATE INDEX IF NOT EXISTS idx_sessions_mentee_id ON sessions(mentee_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_reminders ON sessions(reminded_24h, reminded_1h) WHERE status = 'confirmed';

-- Create mentor_availability table for recurring patterns
CREATE TABLE IF NOT EXISTS mentor_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  timezone VARCHAR(50) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT valid_time_range CHECK (end_time > start_time),
  CONSTRAINT valid_availability_timezone CHECK (timezone ~ '^[A-Za-z_]+/[A-Za-z_]+$' OR timezone = 'UTC')
);

-- Create indexes for mentor_availability table
CREATE INDEX IF NOT EXISTS idx_availability_mentor ON mentor_availability(mentor_id);
CREATE INDEX IF NOT EXISTS idx_availability_active ON mentor_availability(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_availability_day ON mentor_availability(day_of_week);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
DROP TRIGGER IF EXISTS update_sessions_updated_at ON sessions;
CREATE TRIGGER update_sessions_updated_at
  BEFORE UPDATE ON sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_availability_updated_at ON mentor_availability;
CREATE TRIGGER update_availability_updated_at
  BEFORE UPDATE ON mentor_availability
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE sessions IS 'Session bookings between mentors and mentees with timezone-aware scheduling';
COMMENT ON COLUMN sessions.scheduled_at_utc IS 'Session start time in UTC (converted from user timezone)';
COMMENT ON COLUMN sessions.duration_minutes IS 'Session duration in minutes (max 8 hours)';
COMMENT ON COLUMN sessions.reminded_24h IS 'Timestamp when 24h reminder was sent';
COMMENT ON COLUMN sessions.reminded_1h IS 'Timestamp when 1h reminder was sent';

COMMENT ON TABLE mentor_availability IS 'Recurring weekly availability patterns for mentors';
COMMENT ON COLUMN mentor_availability.day_of_week IS 'Day of week: 0=Sunday, 1=Monday, ..., 6=Saturday';
COMMENT ON COLUMN mentor_availability.start_time IS 'Start time in mentor local timezone';
COMMENT ON COLUMN mentor_availability.end_time IS 'End time in mentor local timezone';
COMMENT ON COLUMN mentor_availability.timezone IS 'IANA timezone identifier for this availability slot';

-- Insert sample data (optional, for testing)
-- Uncomment for development/testing environments
/*
INSERT INTO mentor_availability (mentor_id, day_of_week, start_time, end_time, timezone)
SELECT 
  id,
  generate_series(1, 5) as day_of_week,
  '09:00:00'::TIME,
  '17:00:00'::TIME,
  'America/New_York'
FROM users 
WHERE role = 'mentor'
LIMIT 1;
*/
