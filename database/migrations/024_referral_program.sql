-- Migration: Referral and Affiliate Program
-- Description: Create comprehensive referral system with XLM token rewards
-- Author: Kiro AI Assistant
-- Date: 2026-05-28

-- Referral codes table
CREATE TABLE referral_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code VARCHAR(20) NOT NULL UNIQUE,
    code_type VARCHAR(20) NOT NULL DEFAULT 'personal' CHECK (code_type IN ('personal', 'affiliate', 'campaign')),
    is_active BOOLEAN DEFAULT true,
    max_uses INTEGER, -- NULL means unlimited
    current_uses INTEGER DEFAULT 0,
    expires_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Referrals table
CREATE TABLE referrals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    referrer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    referral_code_id UUID NOT NULL REFERENCES referral_codes(id) ON DELETE CASCADE,
    referred_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    referred_email VARCHAR(255),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'registered', 'completed', 'rewarded', 'expired', 'cancelled')),
    conversion_type VARCHAR(20) CHECK (conversion_type IN ('signup', 'first_booking', 'first_payment', 'mentor_signup')),
    reward_amount NUMERIC(15, 7) DEFAULT 0,
    reward_currency VARCHAR(10) DEFAULT 'XLM',
    reward_paid BOOLEAN DEFAULT false,
    reward_paid_at TIMESTAMP WITH TIME ZONE,
    reward_transaction_hash VARCHAR(128),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    registered_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB DEFAULT '{}'
);

-- Reward tiers table
CREATE TABLE reward_tiers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    tier_level INTEGER NOT NULL UNIQUE,
    min_referrals INTEGER NOT NULL,
    max_referrals INTEGER, -- NULL means no upper limit
    reward_multiplier NUMERIC(5, 2) NOT NULL DEFAULT 1.00,
    bonus_amount NUMERIC(15, 7) DEFAULT 0,
    bonus_currency VARCHAR(10) DEFAULT 'XLM',
    perks JSONB DEFAULT '[]',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Affiliate profiles table
CREATE TABLE affiliate_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended', 'terminated')),
    tier_id UUID REFERENCES reward_tiers(id),
    total_referrals INTEGER DEFAULT 0,
    successful_referrals INTEGER DEFAULT 0,
    total_earnings NUMERIC(15, 7) DEFAULT 0,
    total_earnings_currency VARCHAR(10) DEFAULT 'XLM',
    pending_earnings NUMERIC(15, 7) DEFAULT 0,
    paid_earnings NUMERIC(15, 7) DEFAULT 0,
    conversion_rate NUMERIC(5, 2) DEFAULT 0,
    payment_method VARCHAR(50) DEFAULT 'stellar',
    stellar_address VARCHAR(100),
    payment_schedule VARCHAR(20) DEFAULT 'monthly' CHECK (payment_schedule IN ('weekly', 'biweekly', 'monthly', 'manual')),
    minimum_payout NUMERIC(15, 7) DEFAULT 10.00,
    approved_at TIMESTAMP WITH TIME ZONE,
    approved_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Reward configurations table
CREATE TABLE reward_configurations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(50) NOT NULL UNIQUE,
    event_description TEXT,
    referrer_reward NUMERIC(15, 7) NOT NULL,
    referred_reward NUMERIC(15, 7) DEFAULT 0,
    reward_currency VARCHAR(10) DEFAULT 'XLM',
    requires_completion BOOLEAN DEFAULT true,
    completion_criteria JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Reward payouts table
CREATE TABLE reward_payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    affiliate_id UUID NOT NULL REFERENCES affiliate_profiles(id) ON DELETE CASCADE,
    payout_type VARCHAR(20) NOT NULL CHECK (payout_type IN ('referral', 'bonus', 'tier_bonus', 'manual')),
    amount NUMERIC(15, 7) NOT NULL,
    currency VARCHAR(10) DEFAULT 'XLM',
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
    payment_method VARCHAR(50) DEFAULT 'stellar',
    stellar_address VARCHAR(100),
    transaction_hash VARCHAR(128),
    processed_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    failed_reason TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Referral campaigns table
CREATE TABLE referral_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    campaign_type VARCHAR(20) NOT NULL CHECK (campaign_type IN ('general', 'mentor_recruitment', 'student_acquisition', 'seasonal', 'limited')),
    start_date TIMESTAMP WITH TIME ZONE NOT NULL,
    end_date TIMESTAMP WITH TIME ZONE,
    target_referrals INTEGER,
    bonus_reward NUMERIC(15, 7) DEFAULT 0,
    bonus_currency VARCHAR(10) DEFAULT 'XLM',
    is_active BOOLEAN DEFAULT true,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Campaign participants table
CREATE TABLE campaign_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES referral_campaigns(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    referral_code_id UUID REFERENCES referral_codes(id),
    referrals_count INTEGER DEFAULT 0,
    bonus_earned NUMERIC(15, 7) DEFAULT 0,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(campaign_id, user_id)
);

-- Referral analytics table
CREATE TABLE referral_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL,
    total_referrals INTEGER DEFAULT 0,
    successful_referrals INTEGER DEFAULT 0,
    total_rewards_paid NUMERIC(15, 7) DEFAULT 0,
    average_conversion_time INTEGER, -- in hours
    top_referrer_id UUID REFERENCES users(id),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(date)
);

-- Indexes for performance
CREATE INDEX idx_referral_codes_user ON referral_codes(user_id) WHERE is_active = true;
CREATE INDEX idx_referral_codes_code ON referral_codes(code) WHERE is_active = true;
CREATE INDEX idx_referral_codes_expires ON referral_codes(expires_at) WHERE expires_at IS NOT NULL;

CREATE INDEX idx_referrals_referrer ON referrals(referrer_id);
CREATE INDEX idx_referrals_referred ON referrals(referred_user_id);
CREATE INDEX idx_referrals_code ON referrals(referral_code_id);
CREATE INDEX idx_referrals_status ON referrals(status);
CREATE INDEX idx_referrals_reward_paid ON referrals(reward_paid) WHERE reward_paid = false;
CREATE INDEX idx_referrals_created ON referrals(created_at DESC);

CREATE INDEX idx_affiliate_profiles_user ON affiliate_profiles(user_id);
CREATE INDEX idx_affiliate_profiles_status ON affiliate_profiles(status);
CREATE INDEX idx_affiliate_profiles_tier ON affiliate_profiles(tier_id);

CREATE INDEX idx_reward_payouts_affiliate ON reward_payouts(affiliate_id);
CREATE INDEX idx_reward_payouts_status ON reward_payouts(status);
CREATE INDEX idx_reward_payouts_created ON reward_payouts(created_at DESC);

CREATE INDEX idx_campaign_participants_campaign ON campaign_participants(campaign_id);
CREATE INDEX idx_campaign_participants_user ON campaign_participants(user_id);

CREATE INDEX idx_referral_analytics_date ON referral_analytics(date DESC);

-- Triggers for updated_at timestamps
CREATE OR REPLACE FUNCTION update_referral_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER referral_codes_update_timestamp
    BEFORE UPDATE ON referral_codes
    FOR EACH ROW
    EXECUTE FUNCTION update_referral_timestamp();

CREATE TRIGGER reward_tiers_update_timestamp
    BEFORE UPDATE ON reward_tiers
    FOR EACH ROW
    EXECUTE FUNCTION update_referral_timestamp();

CREATE TRIGGER affiliate_profiles_update_timestamp
    BEFORE UPDATE ON affiliate_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_referral_timestamp();

CREATE TRIGGER reward_configurations_update_timestamp
    BEFORE UPDATE ON reward_configurations
    FOR EACH ROW
    EXECUTE FUNCTION update_referral_timestamp();

CREATE TRIGGER referral_campaigns_update_timestamp
    BEFORE UPDATE ON referral_campaigns
    FOR EACH ROW
    EXECUTE FUNCTION update_referral_timestamp();

-- Function to update affiliate statistics
CREATE OR REPLACE FUNCTION update_affiliate_stats()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        UPDATE affiliate_profiles
        SET total_referrals = (
                SELECT COUNT(*) FROM referrals WHERE referrer_id = NEW.referrer_id
            ),
            successful_referrals = (
                SELECT COUNT(*) FROM referrals 
                WHERE referrer_id = NEW.referrer_id AND status = 'completed'
            ),
            total_earnings = (
                SELECT COALESCE(SUM(reward_amount), 0) FROM referrals 
                WHERE referrer_id = NEW.referrer_id AND reward_paid = true
            ),
            pending_earnings = (
                SELECT COALESCE(SUM(reward_amount), 0) FROM referrals 
                WHERE referrer_id = NEW.referrer_id AND status = 'completed' AND reward_paid = false
            ),
            paid_earnings = (
                SELECT COALESCE(SUM(reward_amount), 0) FROM referrals 
                WHERE referrer_id = NEW.referrer_id AND reward_paid = true
            ),
            conversion_rate = CASE 
                WHEN (SELECT COUNT(*) FROM referrals WHERE referrer_id = NEW.referrer_id) > 0
                THEN (
                    SELECT COUNT(*) * 100.0 / NULLIF(
                        (SELECT COUNT(*) FROM referrals WHERE referrer_id = NEW.referrer_id), 0
                    )
                    FROM referrals 
                    WHERE referrer_id = NEW.referrer_id AND status = 'completed'
                )
                ELSE 0
            END,
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = NEW.referrer_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_affiliate_stats_trigger
    AFTER INSERT OR UPDATE ON referrals
    FOR EACH ROW
    EXECUTE FUNCTION update_affiliate_stats();

-- Function to check and update reward tiers
CREATE OR REPLACE FUNCTION check_reward_tier()
RETURNS TRIGGER AS $$
DECLARE
    new_tier_id UUID;
BEGIN
    SELECT id INTO new_tier_id
    FROM reward_tiers
    WHERE is_active = true
    AND NEW.successful_referrals >= min_referrals
    AND (max_referrals IS NULL OR NEW.successful_referrals <= max_referrals)
    ORDER BY tier_level DESC
    LIMIT 1;
    
    IF new_tier_id IS NOT NULL AND new_tier_id != COALESCE(NEW.tier_id, '00000000-0000-0000-0000-000000000000'::UUID) THEN
        NEW.tier_id = new_tier_id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER check_reward_tier_trigger
    BEFORE UPDATE ON affiliate_profiles
    FOR EACH ROW
    WHEN (OLD.successful_referrals IS DISTINCT FROM NEW.successful_referrals)
    EXECUTE FUNCTION check_reward_tier();

-- Comments for documentation
COMMENT ON TABLE referral_codes IS 'Stores unique referral codes for users';
COMMENT ON TABLE referrals IS 'Tracks individual referral conversions and rewards';
COMMENT ON TABLE reward_tiers IS 'Defines tiered reward structure based on performance';
COMMENT ON TABLE affiliate_profiles IS 'Stores affiliate program participant information';
COMMENT ON TABLE reward_configurations IS 'Configures reward amounts for different events';
COMMENT ON TABLE reward_payouts IS 'Tracks reward payment transactions';
COMMENT ON TABLE referral_campaigns IS 'Manages time-limited referral campaigns';
COMMENT ON TABLE campaign_participants IS 'Tracks user participation in campaigns';
COMMENT ON TABLE referral_analytics IS 'Stores daily aggregated referral metrics';

-- Insert default reward tiers
INSERT INTO reward_tiers (name, tier_level, min_referrals, max_referrals, reward_multiplier, bonus_amount, perks) VALUES
('Bronze', 1, 0, 4, 1.00, 0, '["Basic affiliate dashboard", "Standard support"]'),
('Silver', 2, 5, 14, 1.25, 25.00, '["Enhanced dashboard", "Priority support", "Marketing materials"]'),
('Gold', 3, 15, 49, 1.50, 100.00, '["Advanced analytics", "Dedicated support", "Custom landing pages", "Early access to features"]'),
('Platinum', 4, 50, 99, 2.00, 500.00, '["Premium analytics", "Account manager", "Custom campaigns", "Exclusive events", "Higher payout priority"]'),
('Diamond', 5, 100, NULL, 2.50, 2000.00, '["Elite status", "Personal account manager", "Revenue sharing", "Strategic partnership", "VIP events", "Custom integrations"]');

-- Insert default reward configurations
INSERT INTO reward_configurations (event_type, event_description, referrer_reward, referred_reward, requires_completion, completion_criteria) VALUES
('user_signup', 'New user signs up with referral code', 5.00, 5.00, false, '{}'),
('mentor_signup', 'New mentor signs up and gets verified', 50.00, 25.00, true, '{"requires_verification": true}'),
('first_booking', 'Referred user completes first booking', 10.00, 0, true, '{"booking_completed": true}'),
('first_payment', 'Referred user makes first payment', 15.00, 0, true, '{"payment_received": true}'),
('mentor_first_session', 'Referred mentor completes first session', 25.00, 0, true, '{"session_completed": true}'),
('subscription', 'Referred user subscribes to premium', 30.00, 0, true, '{"subscription_active": true}');
