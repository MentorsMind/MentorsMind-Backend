-- Migration: Mentor Certification and Verification System
-- Description: Create comprehensive certification system for mentor quality assurance
-- Author: Kiro AI Assistant
-- Date: 2026-05-28

-- Certification types table
CREATE TABLE certification_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    category VARCHAR(50) NOT NULL CHECK (category IN ('skill', 'background', 'platform', 'professional')),
    description TEXT,
    requirements JSONB NOT NULL DEFAULT '{}',
    validity_period_days INTEGER, -- NULL means no expiration
    is_required BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 0,
    badge_icon VARCHAR(255),
    badge_color VARCHAR(20),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Mentor certifications table
CREATE TABLE mentor_certifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mentor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    certification_type_id UUID NOT NULL REFERENCES certification_types(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_review', 'verified', 'rejected', 'expired', 'revoked')),
    verification_method VARCHAR(50) CHECK (verification_method IN ('manual', 'automated', 'third_party', 'test', 'document')),
    verified_by UUID REFERENCES users(id),
    verified_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    revoked_at TIMESTAMP WITH TIME ZONE,
    revocation_reason TEXT,
    score NUMERIC(5, 2), -- For test-based certifications
    metadata JSONB DEFAULT '{}',
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(mentor_id, certification_type_id)
);

-- Certification documents table (for uploaded verification documents)
CREATE TABLE certification_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    certification_id UUID NOT NULL REFERENCES mentor_certifications(id) ON DELETE CASCADE,
    document_type VARCHAR(50) NOT NULL CHECK (document_type IN ('id', 'degree', 'certificate', 'license', 'portfolio', 'reference', 'other')),
    file_name VARCHAR(255) NOT NULL,
    file_url VARCHAR(2048) NOT NULL,
    file_size INTEGER,
    mime_type VARCHAR(100),
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    verified BOOLEAN DEFAULT false,
    verified_at TIMESTAMP WITH TIME ZONE,
    verified_by UUID REFERENCES users(id)
);

-- Skill verification tests table
CREATE TABLE skill_tests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    certification_type_id UUID NOT NULL REFERENCES certification_types(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    difficulty_level VARCHAR(20) CHECK (difficulty_level IN ('beginner', 'intermediate', 'advanced', 'expert')),
    duration_minutes INTEGER NOT NULL,
    passing_score NUMERIC(5, 2) NOT NULL DEFAULT 70.00,
    questions JSONB NOT NULL, -- Array of questions with answers
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Test attempts table
CREATE TABLE test_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mentor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    skill_test_id UUID NOT NULL REFERENCES skill_tests(id) ON DELETE CASCADE,
    certification_id UUID REFERENCES mentor_certifications(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'abandoned', 'expired')),
    score NUMERIC(5, 2),
    passed BOOLEAN,
    answers JSONB, -- User's answers
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,
    time_spent_minutes INTEGER
);

-- Background check requests table
CREATE TABLE background_checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mentor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    certification_id UUID REFERENCES mentor_certifications(id) ON DELETE SET NULL,
    provider VARCHAR(100), -- e.g., 'Checkr', 'Sterling', 'GoodHire'
    check_type VARCHAR(50) NOT NULL CHECK (check_type IN ('criminal', 'identity', 'education', 'employment', 'professional_license', 'comprehensive')),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'cancelled')),
    external_reference_id VARCHAR(255),
    result VARCHAR(20) CHECK (result IN ('clear', 'consider', 'suspended', 'dispute')),
    result_data JSONB,
    requested_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,
    cost NUMERIC(10, 2),
    metadata JSONB DEFAULT '{}'
);

-- Mentor onboarding progress table
CREATE TABLE mentor_onboarding (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mentor_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'completed', 'on_hold')),
    current_step INTEGER DEFAULT 1,
    total_steps INTEGER DEFAULT 10,
    steps_completed JSONB DEFAULT '[]', -- Array of completed step IDs
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Certification reviews/audits table
CREATE TABLE certification_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    certification_id UUID NOT NULL REFERENCES mentor_certifications(id) ON DELETE CASCADE,
    reviewer_id UUID NOT NULL REFERENCES users(id),
    review_type VARCHAR(20) NOT NULL CHECK (review_type IN ('initial', 'renewal', 'audit', 'complaint')),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'needs_info')),
    decision VARCHAR(20) CHECK (decision IN ('approve', 'reject', 'request_more_info', 'escalate')),
    comments TEXT,
    reviewed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'
);

-- Certification renewal reminders table
CREATE TABLE certification_reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    certification_id UUID NOT NULL REFERENCES mentor_certifications(id) ON DELETE CASCADE,
    reminder_type VARCHAR(20) NOT NULL CHECK (reminder_type IN ('expiring_soon', 'expired', 'renewal_available')),
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    acknowledged BOOLEAN DEFAULT false,
    acknowledged_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for performance
CREATE INDEX idx_mentor_certifications_mentor ON mentor_certifications(mentor_id);
CREATE INDEX idx_mentor_certifications_status ON mentor_certifications(status);
CREATE INDEX idx_mentor_certifications_expires ON mentor_certifications(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX idx_mentor_certifications_type ON mentor_certifications(certification_type_id);

CREATE INDEX idx_certification_documents_cert ON certification_documents(certification_id);
CREATE INDEX idx_certification_documents_verified ON certification_documents(verified);

CREATE INDEX idx_test_attempts_mentor ON test_attempts(mentor_id);
CREATE INDEX idx_test_attempts_test ON test_attempts(skill_test_id);
CREATE INDEX idx_test_attempts_status ON test_attempts(status);

CREATE INDEX idx_background_checks_mentor ON background_checks(mentor_id);
CREATE INDEX idx_background_checks_status ON background_checks(status);
CREATE INDEX idx_background_checks_cert ON background_checks(certification_id);

CREATE INDEX idx_mentor_onboarding_status ON mentor_onboarding(status);

CREATE INDEX idx_certification_reviews_cert ON certification_reviews(certification_id);
CREATE INDEX idx_certification_reviews_reviewer ON certification_reviews(reviewer_id);
CREATE INDEX idx_certification_reviews_status ON certification_reviews(status);

CREATE INDEX idx_certification_reminders_cert ON certification_reminders(certification_id);
CREATE INDEX idx_certification_reminders_sent ON certification_reminders(sent_at);

-- Triggers for updated_at timestamps
CREATE OR REPLACE FUNCTION update_certification_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER certification_types_update_timestamp
    BEFORE UPDATE ON certification_types
    FOR EACH ROW
    EXECUTE FUNCTION update_certification_timestamp();

CREATE TRIGGER mentor_certifications_update_timestamp
    BEFORE UPDATE ON mentor_certifications
    FOR EACH ROW
    EXECUTE FUNCTION update_certification_timestamp();

CREATE TRIGGER skill_tests_update_timestamp
    BEFORE UPDATE ON skill_tests
    FOR EACH ROW
    EXECUTE FUNCTION update_certification_timestamp();

CREATE TRIGGER mentor_onboarding_update_timestamp
    BEFORE UPDATE ON mentor_onboarding
    FOR EACH ROW
    EXECUTE FUNCTION update_certification_timestamp();

-- Function to check for expiring certifications
CREATE OR REPLACE FUNCTION check_expiring_certifications()
RETURNS void AS $$
BEGIN
    -- Mark certifications as expired
    UPDATE mentor_certifications
    SET status = 'expired'
    WHERE status = 'verified'
    AND expires_at IS NOT NULL
    AND expires_at < CURRENT_TIMESTAMP;
    
    -- Create reminders for certifications expiring in 30 days
    INSERT INTO certification_reminders (certification_id, reminder_type)
    SELECT id, 'expiring_soon'
    FROM mentor_certifications
    WHERE status = 'verified'
    AND expires_at IS NOT NULL
    AND expires_at BETWEEN CURRENT_TIMESTAMP AND CURRENT_TIMESTAMP + INTERVAL '30 days'
    AND id NOT IN (
        SELECT certification_id 
        FROM certification_reminders 
        WHERE reminder_type = 'expiring_soon'
        AND sent_at > CURRENT_TIMESTAMP - INTERVAL '7 days'
    );
END;
$$ LANGUAGE plpgsql;

-- Comments for documentation
COMMENT ON TABLE certification_types IS 'Defines available certification types and their requirements';
COMMENT ON TABLE mentor_certifications IS 'Tracks mentor certifications and their verification status';
COMMENT ON TABLE certification_documents IS 'Stores uploaded verification documents';
COMMENT ON TABLE skill_tests IS 'Defines skill verification tests';
COMMENT ON TABLE test_attempts IS 'Tracks mentor test attempts and scores';
COMMENT ON TABLE background_checks IS 'Tracks background check requests and results';
COMMENT ON TABLE mentor_onboarding IS 'Tracks mentor onboarding progress';
COMMENT ON TABLE certification_reviews IS 'Tracks certification review and approval process';
COMMENT ON TABLE certification_reminders IS 'Tracks certification expiration reminders';

-- Insert default certification types
INSERT INTO certification_types (name, category, description, requirements, validity_period_days, is_required, display_order, badge_color) VALUES
('Identity Verification', 'background', 'Verify mentor identity through government-issued ID', '{"documents": ["government_id"], "verification_method": "manual"}', NULL, true, 1, '#4CAF50'),
('Background Check', 'background', 'Comprehensive background screening', '{"check_types": ["criminal", "identity"], "provider": "third_party"}', 1095, true, 2, '#2196F3'),
('Platform Orientation', 'platform', 'Complete platform training and orientation', '{"modules": ["getting_started", "best_practices", "policies"], "quiz_score": 80}', NULL, true, 3, '#FF9800'),
('Teaching Certification', 'professional', 'Verified teaching or training certification', '{"documents": ["teaching_certificate"], "verification_method": "document"}', 1095, false, 4, '#9C27B0'),
('Subject Matter Expert', 'skill', 'Demonstrate expertise in specific subject area', '{"test_required": true, "passing_score": 85}', 730, false, 5, '#F44336'),
('Professional License', 'professional', 'Verified professional license in relevant field', '{"documents": ["professional_license"], "verification_method": "third_party"}', 365, false, 6, '#00BCD4'),
('Advanced Mentor', 'platform', 'Completed advanced mentor training program', '{"sessions_completed": 50, "rating": 4.5, "completion_rate": 80}', 730, false, 7, '#FFD700'),
('Education Verification', 'background', 'Verify educational credentials', '{"documents": ["degree", "transcript"], "verification_method": "third_party"}', NULL, false, 8, '#607D8B');
