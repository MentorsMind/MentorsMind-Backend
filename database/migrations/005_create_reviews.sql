-- =============================================================================
-- Migration: 005_create_reviews.sql
-- Description: Create reviews and ratings table
-- =============================================================================

-- Create reviews table
CREATE TABLE IF NOT EXISTS reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Relationships
    booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    reviewer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reviewee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Rating (1-5 stars)
    rating INTEGER NOT NULL,
    
    -- Review content
    title VARCHAR(255),
    comment TEXT,
    
    -- Detailed ratings (optional breakdown)
    communication_rating INTEGER,
    professionalism_rating INTEGER,
    knowledge_rating INTEGER,
    punctuality_rating INTEGER,
    
    -- Moderation
    is_published BOOLEAN DEFAULT TRUE,
    is_flagged BOOLEAN DEFAULT FALSE,
    flagged_reason TEXT,
    moderated_by UUID REFERENCES users(id),
    moderated_at TIMESTAMP WITH TIME ZONE,
    
    -- Response from reviewee
    response TEXT,
    response_at TIMESTAMP WITH TIME ZONE,
    
    -- Helpfulness tracking
    helpful_count INTEGER DEFAULT 0,
    not_helpful_count INTEGER DEFAULT 0,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'::jsonb,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Unique constraint: one review per booking per reviewer
    UNIQUE(booking_id, reviewer_id)
);

-- Create review_votes table for helpful/not helpful tracking
CREATE TABLE IF NOT EXISTS review_votes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Relationships
    review_id UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Vote
    is_helpful BOOLEAN NOT NULL,
    
    -- Timestamp
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Unique constraint: one vote per user per review
    UNIQUE(review_id, user_id)
);

-- Create review_reports table for flagging inappropriate reviews
CREATE TABLE IF NOT EXISTS review_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Relationships
    review_id UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Report details
    reason VARCHAR(100) NOT NULL, -- spam, inappropriate, fake, offensive, etc.
    description TEXT,
    
    -- Status
    status VARCHAR(20) DEFAULT 'pending', -- pending, reviewed, resolved, dismissed
    resolved_by UUID REFERENCES users(id),
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolution_notes TEXT,
    
    -- Timestamp
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for reviews
CREATE INDEX idx_reviews_booking_id ON reviews(booking_id);
CREATE INDEX idx_reviews_reviewer_id ON reviews(reviewer_id);
CREATE INDEX idx_reviews_reviewee_id ON reviews(reviewee_id);
CREATE INDEX idx_reviews_rating ON reviews(rating);
CREATE INDEX idx_reviews_created_at ON reviews(created_at);
CREATE INDEX idx_reviews_published ON reviews(is_published) WHERE is_published = TRUE;
CREATE INDEX idx_reviews_flagged ON reviews(is_flagged) WHERE is_flagged = TRUE;
CREATE INDEX idx_reviews_reviewee_published ON reviews(reviewee_id, is_published, created_at) 
    WHERE is_published = TRUE;

-- Create indexes for review_votes
CREATE INDEX idx_review_votes_review_id ON review_votes(review_id);
CREATE INDEX idx_review_votes_user_id ON review_votes(user_id);

-- Create indexes for review_reports
CREATE INDEX idx_review_reports_review_id ON review_reports(review_id);
CREATE INDEX idx_review_reports_reporter_id ON review_reports(reporter_id);
CREATE INDEX idx_review_reports_status ON review_reports(status);

-- Add constraints
ALTER TABLE reviews ADD CONSTRAINT check_rating_range CHECK (rating >= 1 AND rating <= 5);
ALTER TABLE reviews ADD CONSTRAINT check_detailed_ratings CHECK (
    (communication_rating IS NULL OR (communication_rating >= 1 AND communication_rating <= 5)) AND
    (professionalism_rating IS NULL OR (professionalism_rating >= 1 AND professionalism_rating <= 5)) AND
    (knowledge_rating IS NULL OR (knowledge_rating >= 1 AND knowledge_rating <= 5)) AND
    (punctuality_rating IS NULL OR (punctuality_rating >= 1 AND punctuality_rating <= 5))
);
ALTER TABLE reviews ADD CONSTRAINT check_reviewer_not_reviewee CHECK (reviewer_id != reviewee_id);
ALTER TABLE reviews ADD CONSTRAINT check_helpful_counts CHECK (helpful_count >= 0 AND not_helpful_count >= 0);

-- Add comments
COMMENT ON TABLE reviews IS 'User reviews and ratings for completed mentorship sessions';
COMMENT ON TABLE review_votes IS 'User votes on review helpfulness';
COMMENT ON TABLE review_reports IS 'Reports of inappropriate or fake reviews';
COMMENT ON COLUMN reviews.rating IS 'Overall rating from 1 to 5 stars';
COMMENT ON COLUMN reviews.helpful_count IS 'Number of users who found this review helpful';
