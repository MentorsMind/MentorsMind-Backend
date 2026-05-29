-- =============================================================================
-- Migration: 001_create_users.sql
-- Description: Create users table with Stellar integration and role-based access
-- =============================================================================

-- Create ENUM types for user roles and status
CREATE TYPE user_role AS ENUM ('mentee', 'mentor', 'admin');
CREATE TYPE user_status AS ENUM ('active', 'inactive', 'suspended', 'pending_verification');

-- Create users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Basic Information
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    username VARCHAR(100) UNIQUE,
    full_name VARCHAR(255),
    
    -- Role and Status
    role user_role NOT NULL DEFAULT 'mentee',
    status user_status NOT NULL DEFAULT 'pending_verification',
    
    -- Stellar Integration
    stellar_public_key VARCHAR(56) UNIQUE, -- Stellar public keys are 56 chars (G...)
    stellar_account_verified BOOLEAN DEFAULT FALSE,
    
    -- Profile Information
    bio TEXT,
    avatar_url VARCHAR(500),
    timezone VARCHAR(50),
    language VARCHAR(10) DEFAULT 'en',
    
    -- Mentor-specific fields
    hourly_rate DECIMAL(10, 2), -- Rate in USD or platform currency
    expertise TEXT[], -- Array of expertise areas
    years_of_experience INTEGER,
    availability_schedule JSONB, -- Flexible schedule storage
    is_available BOOLEAN DEFAULT TRUE,
    
    -- Verification and Trust
    email_verified BOOLEAN DEFAULT FALSE,
    email_verified_at TIMESTAMP WITH TIME ZONE,
    kyc_verified BOOLEAN DEFAULT FALSE,
    kyc_verified_at TIMESTAMP WITH TIME ZONE,
    
    -- Statistics
    total_sessions_completed INTEGER DEFAULT 0,
    average_rating DECIMAL(3, 2) DEFAULT 0.00, -- 0.00 to 5.00
    total_reviews INTEGER DEFAULT 0,
    
    -- Security
    last_login_at TIMESTAMP WITH TIME ZONE,
    last_login_ip VARCHAR(45),
    failed_login_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMP WITH TIME ZONE,
    password_changed_at TIMESTAMP WITH TIME ZONE,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'::jsonb,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE -- Soft delete support
);

-- Create indexes for performance
CREATE INDEX idx_users_email ON users(email) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_username ON users(username) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_stellar_public_key ON users(stellar_public_key) WHERE stellar_public_key IS NOT NULL;
CREATE INDEX idx_users_role ON users(role) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_created_at ON users(created_at);
CREATE INDEX idx_users_mentor_available ON users(role, is_available) WHERE role = 'mentor' AND deleted_at IS NULL;
CREATE INDEX idx_users_expertise ON users USING GIN(expertise) WHERE role = 'mentor';

-- Add constraints
ALTER TABLE users ADD CONSTRAINT check_email_format CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');
ALTER TABLE users ADD CONSTRAINT check_hourly_rate CHECK (hourly_rate IS NULL OR hourly_rate >= 0);
ALTER TABLE users ADD CONSTRAINT check_average_rating CHECK (average_rating >= 0 AND average_rating <= 5);
ALTER TABLE users ADD CONSTRAINT check_stellar_key_format CHECK (stellar_public_key IS NULL OR stellar_public_key ~ '^G[A-Z2-7]{55}$');

-- Add comments for documentation
COMMENT ON TABLE users IS 'Core users table storing mentees, mentors, and admins with Stellar integration';
COMMENT ON COLUMN users.stellar_public_key IS 'Stellar blockchain public key for wallet integration';
COMMENT ON COLUMN users.availability_schedule IS 'JSON object storing mentor availability by day/time';
COMMENT ON COLUMN users.metadata IS 'Flexible JSON storage for additional user attributes';
