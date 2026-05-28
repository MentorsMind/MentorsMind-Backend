-- Migration: Learning Path Builder Database Schema
-- Description: Create comprehensive database schema for learning paths, milestones, enrollments, and progress tracking
-- Author: Kiro AI Assistant
-- Date: 2026-05-28

-- Learning paths table
CREATE TABLE learning_paths (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mentor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    estimated_duration_hours INTEGER NOT NULL,
    difficulty_level VARCHAR(20) NOT NULL CHECK (difficulty_level IN ('beginner', 'intermediate', 'advanced', 'expert')),
    total_price NUMERIC(15, 2),
    pricing_model VARCHAR(20) NOT NULL DEFAULT 'total' CHECK (pricing_model IN ('total', 'milestone', 'subscription')),
    currency VARCHAR(10) NOT NULL DEFAULT 'XLM',
    is_published BOOLEAN DEFAULT false,
    is_template BOOLEAN DEFAULT false,
    template_id UUID REFERENCES learning_paths(id),
    enrolled_count INTEGER DEFAULT 0,
    completion_count INTEGER DEFAULT 0,
    rating NUMERIC(3, 2) DEFAULT 0,
    review_count INTEGER DEFAULT 0,
    tags TEXT[],
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for learning paths
CREATE INDEX idx_learning_paths_mentor ON learning_paths(mentor_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_learning_paths_published ON learning_paths(is_published) WHERE is_published = true AND deleted_at IS NULL;
CREATE INDEX idx_learning_paths_template ON learning_paths(is_template) WHERE is_template = true AND deleted_at IS NULL;
CREATE INDEX idx_learning_paths_tags ON learning_paths USING GIN(tags);
CREATE INDEX idx_learning_paths_difficulty ON learning_paths(difficulty_level);
CREATE INDEX idx_learning_paths_rating ON learning_paths(rating DESC) WHERE is_published = true AND deleted_at IS NULL;
CREATE INDEX idx_learning_paths_created ON learning_paths(created_at DESC);

-- Milestones table
CREATE TABLE milestones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    learning_path_id UUID NOT NULL REFERENCES learning_paths(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    order_index INTEGER NOT NULL,
    estimated_duration_hours INTEGER NOT NULL,
    price NUMERIC(15, 2),
    learning_objectives TEXT[],
    completion_criteria JSONB NOT NULL DEFAULT '{}',
    resources JSONB DEFAULT '[]',
    is_required BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(learning_path_id, order_index)
);

-- Indexes for milestones
CREATE INDEX idx_milestones_path ON milestones(learning_path_id, order_index);
CREATE INDEX idx_milestones_path_required ON milestones(learning_path_id) WHERE is_required = true;

-- Prerequisites table
CREATE TABLE prerequisites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    milestone_id UUID NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
    prerequisite_type VARCHAR(20) NOT NULL CHECK (prerequisite_type IN ('milestone', 'skill', 'assessment')),
    prerequisite_id UUID, -- References milestones(id) for milestone prerequisites
    skill_name VARCHAR(255), -- For skill-based prerequisites
    assessment_criteria JSONB, -- For assessment-based prerequisites
    is_required BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for prerequisites
CREATE INDEX idx_prerequisites_milestone ON prerequisites(milestone_id);
CREATE INDEX idx_prerequisites_type ON prerequisites(prerequisite_type);
CREATE INDEX idx_prerequisites_target ON prerequisites(prerequisite_id) WHERE prerequisite_type = 'milestone';

-- Student enrollments table
CREATE TABLE path_enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    learning_path_id UUID NOT NULL REFERENCES learning_paths(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
    progress_percentage NUMERIC(5, 2) DEFAULT 0,
    current_milestone_id UUID REFERENCES milestones(id),
    enrolled_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    paused_at TIMESTAMP WITH TIME ZONE,
    cancelled_at TIMESTAMP WITH TIME ZONE,
    cancellation_reason TEXT,
    payment_status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'refunded', 'failed', 'partial')),
    total_paid NUMERIC(15, 2) DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    UNIQUE(learning_path_id, student_id)
);

-- Indexes for enrollments
CREATE INDEX idx_enrollments_student ON path_enrollments(student_id, status);
CREATE INDEX idx_enrollments_path ON path_enrollments(learning_path_id, status);
CREATE INDEX idx_enrollments_status ON path_enrollments(status);
CREATE INDEX idx_enrollments_current_milestone ON path_enrollments(current_milestone_id) WHERE current_milestone_id IS NOT NULL;
CREATE INDEX idx_enrollments_enrolled_at ON path_enrollments(enrolled_at DESC);

-- Milestone progress tracking
CREATE TABLE milestone_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enrollment_id UUID NOT NULL REFERENCES path_enrollments(id) ON DELETE CASCADE,
    milestone_id UUID NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'completed', 'skipped')),
    progress_percentage NUMERIC(5, 2) DEFAULT 0,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    time_spent_minutes INTEGER DEFAULT 0,
    completion_data JSONB DEFAULT '{}',
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(enrollment_id, milestone_id)
);

-- Indexes for milestone progress
CREATE INDEX idx_milestone_progress_enrollment ON milestone_progress(enrollment_id);
CREATE INDEX idx_milestone_progress_milestone ON milestone_progress(milestone_id);
CREATE INDEX idx_milestone_progress_status ON milestone_progress(status);
CREATE INDEX idx_milestone_progress_completed ON milestone_progress(completed_at DESC) WHERE status = 'completed';

-- Session mapping to milestones
CREATE TABLE milestone_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    milestone_id UUID NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
    booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    session_type VARCHAR(20) NOT NULL DEFAULT 'milestone' CHECK (session_type IN ('milestone', 'support', 'assessment')),
    contributes_to_completion BOOLEAN DEFAULT true,
    completion_weight NUMERIC(3, 2) DEFAULT 1.0 CHECK (completion_weight >= 0 AND completion_weight <= 1),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(milestone_id, booking_id)
);

-- Indexes for milestone sessions
CREATE INDEX idx_milestone_sessions_milestone ON milestone_sessions(milestone_id);
CREATE INDEX idx_milestone_sessions_booking ON milestone_sessions(booking_id);
CREATE INDEX idx_milestone_sessions_type ON milestone_sessions(session_type);

-- Completion certificates
CREATE TABLE completion_certificates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enrollment_id UUID REFERENCES path_enrollments(id) ON DELETE CASCADE,
    milestone_id UUID REFERENCES milestones(id) ON DELETE CASCADE,
    certificate_type VARCHAR(20) NOT NULL CHECK (certificate_type IN ('milestone', 'path')),
    certificate_data JSONB NOT NULL,
    verification_hash VARCHAR(128) UNIQUE NOT NULL,
    blockchain_tx_hash VARCHAR(128),
    issued_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE,
    is_revoked BOOLEAN DEFAULT false,
    revoked_at TIMESTAMP WITH TIME ZONE,
    revocation_reason TEXT,
    CONSTRAINT certificate_target_check CHECK (
        (certificate_type = 'milestone' AND milestone_id IS NOT NULL AND enrollment_id IS NULL) OR
        (certificate_type = 'path' AND enrollment_id IS NOT NULL AND milestone_id IS NULL)
    )
);

-- Indexes for certificates
CREATE INDEX idx_certificates_enrollment ON completion_certificates(enrollment_id);
CREATE INDEX idx_certificates_milestone ON completion_certificates(milestone_id);
CREATE INDEX idx_certificates_verification ON completion_certificates(verification_hash);
CREATE INDEX idx_certificates_type ON completion_certificates(certificate_type);
CREATE INDEX idx_certificates_issued ON completion_certificates(issued_at DESC);

-- Prerequisite overrides audit
CREATE TABLE prerequisite_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mentor_id UUID NOT NULL REFERENCES users(id),
    student_id UUID NOT NULL REFERENCES users(id),
    milestone_id UUID NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
    prerequisite_id UUID NOT NULL REFERENCES prerequisites(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    overridden_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for overrides
CREATE INDEX idx_overrides_mentor ON prerequisite_overrides(mentor_id);
CREATE INDEX idx_overrides_student ON prerequisite_overrides(student_id);
CREATE INDEX idx_overrides_milestone ON prerequisite_overrides(milestone_id);
CREATE INDEX idx_overrides_date ON prerequisite_overrides(overridden_at DESC);

-- Path reviews and ratings
CREATE TABLE path_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    learning_path_id UUID NOT NULL REFERENCES learning_paths(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    enrollment_id UUID NOT NULL REFERENCES path_enrollments(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    review_text TEXT,
    is_anonymous BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(learning_path_id, student_id)
);

-- Indexes for path reviews
CREATE INDEX idx_path_reviews_path ON path_reviews(learning_path_id);
CREATE INDEX idx_path_reviews_student ON path_reviews(student_id);
CREATE INDEX idx_path_reviews_rating ON path_reviews(rating);
CREATE INDEX idx_path_reviews_created ON path_reviews(created_at DESC);

-- Learning path analytics
CREATE TABLE path_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    learning_path_id UUID NOT NULL REFERENCES learning_paths(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    new_enrollments INTEGER DEFAULT 0,
    active_students INTEGER DEFAULT 0,
    completions INTEGER DEFAULT 0,
    dropouts INTEGER DEFAULT 0,
    avg_progress_percentage NUMERIC(5, 2) DEFAULT 0,
    avg_time_to_complete_hours INTEGER DEFAULT 0,
    revenue NUMERIC(15, 2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(learning_path_id, date)
);

-- Indexes for path analytics
CREATE INDEX idx_path_analytics_path_date ON path_analytics(learning_path_id, date DESC);
CREATE INDEX idx_path_analytics_date ON path_analytics(date DESC);

-- Session outcomes table for tracking session results and milestone progress
CREATE TABLE session_outcomes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    milestone_id UUID REFERENCES milestones(id) ON DELETE CASCADE,
    mentor_feedback TEXT,
    student_feedback TEXT,
    objectives_achieved JSONB DEFAULT '[]',
    skills_improved JSONB DEFAULT '[]',
    next_steps JSONB DEFAULT '[]',
    progress_contribution NUMERIC(5, 2) DEFAULT 0 CHECK (progress_contribution >= 0 AND progress_contribution <= 100),
    completion_status VARCHAR(20) NOT NULL DEFAULT 'in_progress' CHECK (completion_status IN ('not_started', 'in_progress', 'completed', 'needs_review')),
    session_effectiveness INTEGER CHECK (session_effectiveness >= 1 AND session_effectiveness <= 5),
    recommended_follow_up VARCHAR(20) CHECK (recommended_follow_up IN ('continue', 'assessment', 'support', 'complete')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(booking_id)
);

-- Indexes for session outcomes
CREATE INDEX idx_session_outcomes_booking ON session_outcomes(booking_id);
CREATE INDEX idx_session_outcomes_milestone ON session_outcomes(milestone_id);
CREATE INDEX idx_session_outcomes_completion_status ON session_outcomes(completion_status);
CREATE INDEX idx_session_outcomes_created_at ON session_outcomes(created_at DESC);
CREATE INDEX idx_session_outcomes_effectiveness ON session_outcomes(session_effectiveness) WHERE session_effectiveness IS NOT NULL;

-- Milestone forums table for collaborative learning
CREATE TABLE milestone_forums (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    milestone_id UUID NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    message_count INTEGER DEFAULT 0,
    participant_count INTEGER DEFAULT 0,
    last_activity TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(milestone_id)
);

CREATE INDEX idx_milestone_forums_milestone ON milestone_forums(milestone_id);
CREATE INDEX idx_milestone_forums_active ON milestone_forums(is_active) WHERE is_active = true;
CREATE INDEX idx_milestone_forums_activity ON milestone_forums(last_activity DESC);

-- Forum messages table
CREATE TABLE forum_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    forum_id UUID NOT NULL REFERENCES milestone_forums(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    parent_message_id UUID REFERENCES forum_messages(id) ON DELETE CASCADE,
    is_moderated BOOLEAN DEFAULT false,
    like_count INTEGER DEFAULT 0,
    reply_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_forum_messages_forum ON forum_messages(forum_id, created_at DESC);
CREATE INDEX idx_forum_messages_user ON forum_messages(user_id);
CREATE INDEX idx_forum_messages_parent ON forum_messages(parent_message_id) WHERE parent_message_id IS NOT NULL;

-- Study groups table
CREATE TABLE study_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    learning_path_id UUID NOT NULL REFERENCES learning_paths(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    max_members INTEGER DEFAULT 10 CHECK (max_members > 0),
    current_members INTEGER DEFAULT 0,
    is_public BOOLEAN DEFAULT true,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'completed')),
    meeting_schedule TEXT,
    communication_channel TEXT,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_study_groups_path ON study_groups(learning_path_id);
CREATE INDEX idx_study_groups_status ON study_groups(status);
CREATE INDEX idx_study_groups_public ON study_groups(is_public) WHERE is_public = true;
CREATE INDEX idx_study_groups_creator ON study_groups(created_by);

-- Study group members table
CREATE TABLE study_group_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    study_group_id UUID NOT NULL REFERENCES study_groups(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) DEFAULT 'member' CHECK (role IN ('leader', 'member')),
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_active TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    contribution_score INTEGER DEFAULT 0,
    UNIQUE(study_group_id, user_id)
);

CREATE INDEX idx_study_group_members_group ON study_group_members(study_group_id);
CREATE INDEX idx_study_group_members_user ON study_group_members(user_id);
CREATE INDEX idx_study_group_members_role ON study_group_members(role);

-- Milestone submissions table (for peer review)
CREATE TABLE milestone_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enrollment_id UUID NOT NULL REFERENCES path_enrollments(id) ON DELETE CASCADE,
    milestone_id UUID NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
    submission_data JSONB NOT NULL,
    status VARCHAR(20) DEFAULT 'submitted' CHECK (status IN ('draft', 'submitted', 'under_review', 'approved', 'rejected')),
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    feedback TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(enrollment_id, milestone_id)
);

CREATE INDEX idx_milestone_submissions_enrollment ON milestone_submissions(enrollment_id);
CREATE INDEX idx_milestone_submissions_milestone ON milestone_submissions(milestone_id);
CREATE INDEX idx_milestone_submissions_status ON milestone_submissions(status);

-- Peer reviews table
CREATE TABLE peer_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    milestone_id UUID NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
    submission_id UUID NOT NULL REFERENCES milestone_submissions(id) ON DELETE CASCADE,
    reviewer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    submitter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    feedback TEXT NOT NULL,
    criteria JSONB DEFAULT '[]',
    is_anonymous BOOLEAN DEFAULT false,
    status VARCHAR(20) DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'disputed')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(submission_id, reviewer_id)
);

CREATE INDEX idx_peer_reviews_submission ON peer_reviews(submission_id);
CREATE INDEX idx_peer_reviews_reviewer ON peer_reviews(reviewer_id);
CREATE INDEX idx_peer_reviews_submitter ON peer_reviews(submitter_id);
CREATE INDEX idx_peer_reviews_milestone ON peer_reviews(milestone_id);
CREATE INDEX idx_peer_reviews_rating ON peer_reviews(rating);

-- Collaborative projects table
CREATE TABLE collaborative_projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    milestone_id UUID NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    max_participants INTEGER DEFAULT 5 CHECK (max_participants > 0),
    current_participants INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'planning' CHECK (status IN ('planning', 'active', 'review', 'completed')),
    deadline TIMESTAMP WITH TIME ZONE,
    deliverables JSONB DEFAULT '[]',
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_collaborative_projects_milestone ON collaborative_projects(milestone_id);
CREATE INDEX idx_collaborative_projects_status ON collaborative_projects(status);
CREATE INDEX idx_collaborative_projects_creator ON collaborative_projects(created_by);
CREATE INDEX idx_collaborative_projects_deadline ON collaborative_projects(deadline) WHERE deadline IS NOT NULL;

-- Project participants table
CREATE TABLE project_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES collaborative_projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) DEFAULT 'contributor' CHECK (role IN ('leader', 'contributor')),
    responsibilities JSONB DEFAULT '[]',
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    contribution_level INTEGER DEFAULT 0 CHECK (contribution_level >= 0 AND contribution_level <= 100),
    UNIQUE(project_id, user_id)
);

CREATE INDEX idx_project_participants_project ON project_participants(project_id);
CREATE INDEX idx_project_participants_user ON project_participants(user_id);
CREATE INDEX idx_project_participants_role ON project_participants(role);

-- Triggers for updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_learning_paths_updated_at BEFORE UPDATE ON learning_paths FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_milestones_updated_at BEFORE UPDATE ON milestones FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_path_enrollments_updated_at BEFORE UPDATE ON path_enrollments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_milestone_progress_updated_at BEFORE UPDATE ON milestone_progress FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_path_reviews_updated_at BEFORE UPDATE ON path_reviews FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_session_outcomes_updated_at BEFORE UPDATE ON session_outcomes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_milestone_forums_updated_at BEFORE UPDATE ON milestone_forums FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_forum_messages_updated_at BEFORE UPDATE ON forum_messages FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_study_groups_updated_at BEFORE UPDATE ON study_groups FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_milestone_submissions_updated_at BEFORE UPDATE ON milestone_submissions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_peer_reviews_updated_at BEFORE UPDATE ON peer_reviews FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_collaborative_projects_updated_at BEFORE UPDATE ON collaborative_projects FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger to update learning path statistics
CREATE OR REPLACE FUNCTION update_learning_path_stats()
RETURNS TRIGGER AS $$
BEGIN
    -- Update enrolled_count when enrollment status changes
    IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.status != NEW.status) THEN
        UPDATE learning_paths 
        SET enrolled_count = (
            SELECT COUNT(*) 
            FROM path_enrollments 
            WHERE learning_path_id = COALESCE(NEW.learning_path_id, OLD.learning_path_id)
            AND status IN ('active', 'paused', 'completed')
        ),
        completion_count = (
            SELECT COUNT(*) 
            FROM path_enrollments 
            WHERE learning_path_id = COALESCE(NEW.learning_path_id, OLD.learning_path_id)
            AND status = 'completed'
        )
        WHERE id = COALESCE(NEW.learning_path_id, OLD.learning_path_id);
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ language 'plpgsql';

CREATE TRIGGER update_learning_path_stats_trigger 
    AFTER INSERT OR UPDATE OR DELETE ON path_enrollments 
    FOR EACH ROW EXECUTE FUNCTION update_learning_path_stats();

-- Trigger to update path ratings
CREATE OR REPLACE FUNCTION update_path_rating()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE learning_paths 
    SET rating = (
        SELECT COALESCE(AVG(rating), 0) 
        FROM path_reviews 
        WHERE learning_path_id = COALESCE(NEW.learning_path_id, OLD.learning_path_id)
    ),
    review_count = (
        SELECT COUNT(*) 
        FROM path_reviews 
        WHERE learning_path_id = COALESCE(NEW.learning_path_id, OLD.learning_path_id)
    )
    WHERE id = COALESCE(NEW.learning_path_id, OLD.learning_path_id);
    
    RETURN COALESCE(NEW, OLD);
END;
$$ language 'plpgsql';

CREATE TRIGGER update_path_rating_trigger 
    AFTER INSERT OR UPDATE OR DELETE ON path_reviews 
    FOR EACH ROW EXECUTE FUNCTION update_path_rating();

-- Function to prevent circular dependencies in prerequisites
CREATE OR REPLACE FUNCTION check_prerequisite_circular_dependency()
RETURNS TRIGGER AS $$
DECLARE
    path_id UUID;
    circular_found BOOLEAN := FALSE;
BEGIN
    -- Only check for milestone prerequisites
    IF NEW.prerequisite_type = 'milestone' AND NEW.prerequisite_id IS NOT NULL THEN
        -- Get the learning path ID for the milestone
        SELECT learning_path_id INTO path_id 
        FROM milestones 
        WHERE id = NEW.milestone_id;
        
        -- Check if the prerequisite milestone is in the same path
        IF EXISTS (
            SELECT 1 FROM milestones 
            WHERE id = NEW.prerequisite_id 
            AND learning_path_id = path_id
        ) THEN
            -- Use recursive CTE to check for circular dependencies
            WITH RECURSIVE dependency_chain AS (
                -- Base case: start with the new prerequisite
                SELECT NEW.prerequisite_id as milestone_id, 1 as depth
                
                UNION ALL
                
                -- Recursive case: follow the chain of prerequisites
                SELECT p.prerequisite_id, dc.depth + 1
                FROM prerequisites p
                JOIN dependency_chain dc ON p.milestone_id = dc.milestone_id
                WHERE p.prerequisite_type = 'milestone' 
                AND p.prerequisite_id IS NOT NULL
                AND dc.depth < 10 -- Prevent infinite recursion
            )
            SELECT EXISTS (
                SELECT 1 FROM dependency_chain 
                WHERE milestone_id = NEW.milestone_id
            ) INTO circular_found;
            
            IF circular_found THEN
                RAISE EXCEPTION 'Circular dependency detected in milestone prerequisites';
            END IF;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER check_prerequisite_circular_dependency_trigger 
    BEFORE INSERT OR UPDATE ON prerequisites 
    FOR EACH ROW EXECUTE FUNCTION check_prerequisite_circular_dependency();

-- Function to validate milestone order indices
CREATE OR REPLACE FUNCTION validate_milestone_order()
RETURNS TRIGGER AS $$
BEGIN
    -- Ensure order_index is positive
    IF NEW.order_index < 0 THEN
        RAISE EXCEPTION 'Milestone order_index must be non-negative';
    END IF;
    
    -- For updates, check if we need to reorder other milestones
    IF TG_OP = 'UPDATE' AND OLD.order_index != NEW.order_index THEN
        -- Shift other milestones if necessary
        IF NEW.order_index < OLD.order_index THEN
            -- Moving milestone earlier, shift others forward
            UPDATE milestones 
            SET order_index = order_index + 1
            WHERE learning_path_id = NEW.learning_path_id
            AND order_index >= NEW.order_index 
            AND order_index < OLD.order_index
            AND id != NEW.id;
        ELSE
            -- Moving milestone later, shift others backward
            UPDATE milestones 
            SET order_index = order_index - 1
            WHERE learning_path_id = NEW.learning_path_id
            AND order_index > OLD.order_index 
            AND order_index <= NEW.order_index
            AND id != NEW.id;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER validate_milestone_order_trigger 
    BEFORE INSERT OR UPDATE ON milestones 
    FOR EACH ROW EXECUTE FUNCTION validate_milestone_order();

-- Comments for documentation
COMMENT ON TABLE learning_paths IS 'Core learning path definitions with mentor ownership and pricing models';
COMMENT ON TABLE milestones IS 'Individual learning milestones within paths with completion criteria';
COMMENT ON TABLE prerequisites IS 'Flexible prerequisite system supporting milestones, skills, and assessments';
COMMENT ON TABLE path_enrollments IS 'Student enrollments in learning paths with progress tracking';
COMMENT ON TABLE milestone_progress IS 'Detailed progress tracking for individual milestones';
COMMENT ON TABLE milestone_sessions IS 'Integration between learning milestones and booking sessions';
COMMENT ON TABLE completion_certificates IS 'Digital certificates for milestone and path completions';
COMMENT ON TABLE prerequisite_overrides IS 'Audit trail for mentor prerequisite overrides';
COMMENT ON TABLE path_reviews IS 'Student reviews and ratings for learning paths';
COMMENT ON TABLE path_analytics IS 'Daily analytics data for learning path performance';

COMMENT ON COLUMN learning_paths.pricing_model IS 'Pricing strategy: total (one-time), milestone (per-milestone), subscription (recurring)';
COMMENT ON COLUMN milestones.completion_criteria IS 'JSON object defining how milestone completion is determined';
COMMENT ON COLUMN milestones.resources IS 'JSON array of learning resources (documents, videos, links)';
COMMENT ON COLUMN prerequisites.prerequisite_type IS 'Type of prerequisite: milestone, skill, or assessment';
COMMENT ON COLUMN path_enrollments.payment_status IS 'Payment status for the enrollment';
COMMENT ON COLUMN milestone_progress.completion_data IS 'JSON object storing completion-specific data and evidence';
COMMENT ON COLUMN milestone_sessions.completion_weight IS 'Weight of this session towards milestone completion (0.0-1.0)';
COMMENT ON COLUMN completion_certificates.verification_hash IS 'Unique hash for certificate verification';