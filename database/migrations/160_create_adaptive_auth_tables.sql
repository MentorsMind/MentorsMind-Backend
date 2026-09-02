-- Adaptive Authentication System Tables

-- User devices for device tracking and trust management
CREATE TABLE IF NOT EXISTS user_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_fingerprint VARCHAR(512) NOT NULL,
    user_agent TEXT,
    device_name VARCHAR(255),
    first_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    trusted_at TIMESTAMP WITH TIME ZONE,
    trust_level INTEGER DEFAULT 0, -- 0=unknown, 1=recognized, 2=trusted
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, device_fingerprint)
);

-- Risk assessments for tracking authentication risk scores
CREATE TABLE IF NOT EXISTS risk_assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    email VARCHAR(255),
    risk_score INTEGER NOT NULL, -- 0-100
    risk_level VARCHAR(20) NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
    factors JSONB NOT NULL DEFAULT '{}',
    reasons JSONB NOT NULL DEFAULT '[]',
    recommended_actions JSONB NOT NULL DEFAULT '[]',
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Authentication attempts tracking
CREATE TABLE IF NOT EXISTS auth_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    email VARCHAR(255),
    success BOOLEAN NOT NULL DEFAULT false,
    failure_reason VARCHAR(255),
    ip_address INET,
    user_agent TEXT,
    device_fingerprint VARCHAR(512),
    risk_score INTEGER,
    authentication_method VARCHAR(50), -- 'password', 'mfa', 'biometric', etc.
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Security incidents tracking
CREATE TABLE IF NOT EXISTS security_incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    incident_type VARCHAR(50) NOT NULL, -- 'suspicious_login', 'fraud_attempt', 'account_takeover', etc.
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    description TEXT,
    ip_address INET,
    user_agent TEXT,
    device_fingerprint VARCHAR(512),
    metadata JSONB DEFAULT '{}',
    status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved', 'false_positive')),
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Biometric profiles for behavioral authentication
CREATE TABLE IF NOT EXISTS biometric_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    baseline_data JSONB NOT NULL DEFAULT '{}',
    confidence DECIMAL(3,2) NOT NULL DEFAULT 0.0 CHECK (confidence >= 0.0 AND confidence <= 1.0),
    sample_count INTEGER NOT NULL DEFAULT 0,
    authenticity_score DECIMAL(3,2) DEFAULT 0.0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    active BOOLEAN DEFAULT true,
    UNIQUE(user_id)
);

-- Biometric samples for training and analysis
CREATE TABLE IF NOT EXISTS biometric_samples (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sample_data JSONB NOT NULL,
    sample_type VARCHAR(50) DEFAULT 'mixed', -- 'keystroke', 'mouse', 'touch', 'mixed'
    quality_score DECIMAL(3,2) DEFAULT 1.0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Biometric verifications log
CREATE TABLE IF NOT EXISTS biometric_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id VARCHAR(255),
    is_authentic BOOLEAN NOT NULL,
    confidence DECIMAL(3,2) NOT NULL,
    anomalies JSONB DEFAULT '[]',
    risk_score INTEGER NOT NULL,
    recommended_actions JSONB DEFAULT '[]',
    verification_time_ms INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Biometric monitoring sessions
CREATE TABLE IF NOT EXISTS biometric_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id VARCHAR(255) NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    ended_at TIMESTAMP WITH TIME ZONE,
    active BOOLEAN DEFAULT true,
    monitoring_interval INTEGER DEFAULT 30, -- seconds
    samples_collected INTEGER DEFAULT 0,
    anomalies_detected INTEGER DEFAULT 0,
    UNIQUE(user_id, session_id)
);

-- Adaptive authentication sessions
CREATE TABLE IF NOT EXISTS adaptive_auth_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id VARCHAR(255) NOT NULL,
    authentication_factors JSONB DEFAULT '[]', -- List of completed factors
    completed_factors JSONB DEFAULT '[]', -- Array of factor names
    strength_score INTEGER DEFAULT 0 CHECK (strength_score >= 0 AND strength_score <= 100),
    progressive_level INTEGER DEFAULT 1 CHECK (progressive_level >= 1 AND progressive_level <= 5),
    risk_score INTEGER DEFAULT 0,
    last_verification TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, session_id)
);

-- Authentication challenges
CREATE TABLE IF NOT EXISTS auth_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge_id VARCHAR(255) NOT NULL UNIQUE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL, -- 'mfa', 'email_verification', 'biometric', etc.
    required BOOLEAN DEFAULT true,
    message TEXT NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    metadata JSONB DEFAULT '{}',
    completed_at TIMESTAMP WITH TIME ZONE,
    success BOOLEAN,
    failure_reason TEXT,
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Adaptive authentication decisions log
CREATE TABLE IF NOT EXISTS adaptive_auth_decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    session_id VARCHAR(255) NOT NULL,
    decision VARCHAR(20) NOT NULL CHECK (decision IN ('allow', 'challenge', 'block')),
    risk_score INTEGER NOT NULL,
    risk_level VARCHAR(20) NOT NULL,
    reasons JSONB DEFAULT '[]',
    challenges JSONB DEFAULT '[]',
    authentication_strength INTEGER DEFAULT 0,
    processing_time_ms INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Continuous authentication sessions
CREATE TABLE IF NOT EXISTS continuous_auth_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id VARCHAR(255) NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    last_verification TIMESTAMP WITH TIME ZONE NOT NULL,
    next_verification_at TIMESTAMP WITH TIME ZONE,
    authentication_strength INTEGER DEFAULT 0,
    risk_trend VARCHAR(20) DEFAULT 'stable' CHECK (risk_trend IN ('decreasing', 'stable', 'increasing')),
    verification_count INTEGER DEFAULT 0,
    anomaly_count INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    ended_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, session_id)
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_devices_user_id ON user_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_user_devices_fingerprint ON user_devices(device_fingerprint);
CREATE INDEX IF NOT EXISTS idx_user_devices_trusted ON user_devices(user_id, trusted_at) WHERE trusted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_risk_assessments_user_id ON risk_assessments(user_id);
CREATE INDEX IF NOT EXISTS idx_risk_assessments_email ON risk_assessments(email);
CREATE INDEX IF NOT EXISTS idx_risk_assessments_created_at ON risk_assessments(created_at);
CREATE INDEX IF NOT EXISTS idx_risk_assessments_risk_level ON risk_assessments(risk_level);

CREATE INDEX IF NOT EXISTS idx_auth_attempts_user_id ON auth_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_attempts_email ON auth_attempts(email);
CREATE INDEX IF NOT EXISTS idx_auth_attempts_success ON auth_attempts(success);
CREATE INDEX IF NOT EXISTS idx_auth_attempts_created_at ON auth_attempts(created_at);
CREATE INDEX IF NOT EXISTS idx_auth_attempts_ip_address ON auth_attempts(ip_address);

CREATE INDEX IF NOT EXISTS idx_security_incidents_user_id ON security_incidents(user_id);
CREATE INDEX IF NOT EXISTS idx_security_incidents_type ON security_incidents(incident_type);
CREATE INDEX IF NOT EXISTS idx_security_incidents_severity ON security_incidents(severity);
CREATE INDEX IF NOT EXISTS idx_security_incidents_status ON security_incidents(status);
CREATE INDEX IF NOT EXISTS idx_security_incidents_created_at ON security_incidents(created_at);

CREATE INDEX IF NOT EXISTS idx_biometric_profiles_user_id ON biometric_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_biometric_profiles_active ON biometric_profiles(active);

CREATE INDEX IF NOT EXISTS idx_biometric_samples_user_id ON biometric_samples(user_id);
CREATE INDEX IF NOT EXISTS idx_biometric_samples_created_at ON biometric_samples(created_at);
CREATE INDEX IF NOT EXISTS idx_biometric_samples_type ON biometric_samples(sample_type);

CREATE INDEX IF NOT EXISTS idx_biometric_verifications_user_id ON biometric_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_biometric_verifications_session_id ON biometric_verifications(session_id);
CREATE INDEX IF NOT EXISTS idx_biometric_verifications_created_at ON biometric_verifications(created_at);

CREATE INDEX IF NOT EXISTS idx_biometric_sessions_user_id ON biometric_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_biometric_sessions_session_id ON biometric_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_biometric_sessions_active ON biometric_sessions(active);

CREATE INDEX IF NOT EXISTS idx_adaptive_auth_sessions_user_id ON adaptive_auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_adaptive_auth_sessions_session_id ON adaptive_auth_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_adaptive_auth_sessions_active ON adaptive_auth_sessions(active);

CREATE INDEX IF NOT EXISTS idx_auth_challenges_user_id ON auth_challenges(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_challenges_challenge_id ON auth_challenges(challenge_id);
CREATE INDEX IF NOT EXISTS idx_auth_challenges_type ON auth_challenges(type);
CREATE INDEX IF NOT EXISTS idx_auth_challenges_expires_at ON auth_challenges(expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_challenges_completed_at ON auth_challenges(completed_at);

CREATE INDEX IF NOT EXISTS idx_adaptive_auth_decisions_user_id ON adaptive_auth_decisions(user_id);
CREATE INDEX IF NOT EXISTS idx_adaptive_auth_decisions_session_id ON adaptive_auth_decisions(session_id);
CREATE INDEX IF NOT EXISTS idx_adaptive_auth_decisions_decision ON adaptive_auth_decisions(decision);
CREATE INDEX IF NOT EXISTS idx_adaptive_auth_decisions_created_at ON adaptive_auth_decisions(created_at);

CREATE INDEX IF NOT EXISTS idx_continuous_auth_sessions_user_id ON continuous_auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_continuous_auth_sessions_session_id ON continuous_auth_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_continuous_auth_sessions_active ON continuous_auth_sessions(is_active);
CREATE INDEX IF NOT EXISTS idx_continuous_auth_sessions_next_verification ON continuous_auth_sessions(next_verification_at);

-- Create trigger to update timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_user_devices_updated_at BEFORE UPDATE ON user_devices FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_security_incidents_updated_at BEFORE UPDATE ON security_incidents FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_biometric_profiles_updated_at BEFORE UPDATE ON biometric_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_adaptive_auth_sessions_updated_at BEFORE UPDATE ON adaptive_auth_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create materialized view for risk analytics
CREATE MATERIALIZED VIEW IF NOT EXISTS risk_analytics_summary AS
SELECT 
    DATE_TRUNC('day', created_at) as date,
    risk_level,
    COUNT(*) as assessment_count,
    AVG(risk_score) as avg_risk_score,
    COUNT(DISTINCT user_id) as unique_users,
    COUNT(DISTINCT ip_address) as unique_ips
FROM risk_assessments 
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY DATE_TRUNC('day', created_at), risk_level
ORDER BY date DESC, risk_level;

CREATE UNIQUE INDEX IF NOT EXISTS idx_risk_analytics_summary_date_level ON risk_analytics_summary(date, risk_level);

-- Create function to refresh analytics (call this periodically)
CREATE OR REPLACE FUNCTION refresh_risk_analytics() RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY risk_analytics_summary;
END;
$$ LANGUAGE plpgsql;

-- Add comment for documentation
COMMENT ON TABLE user_devices IS 'Tracks user devices for device-based authentication and trust management';
COMMENT ON TABLE risk_assessments IS 'Stores risk assessment results for authentication attempts';
COMMENT ON TABLE auth_attempts IS 'Logs all authentication attempts with success/failure and risk information';
COMMENT ON TABLE security_incidents IS 'Tracks security incidents and threats for investigation';
COMMENT ON TABLE biometric_profiles IS 'Stores user behavioral biometric baselines';
COMMENT ON TABLE biometric_samples IS 'Raw biometric data samples for training and analysis';
COMMENT ON TABLE biometric_verifications IS 'Log of biometric verification attempts and results';
COMMENT ON TABLE adaptive_auth_sessions IS 'Manages progressive authentication sessions and strength scores';
COMMENT ON TABLE auth_challenges IS 'Authentication challenges issued to users';
COMMENT ON TABLE continuous_auth_sessions IS 'Sessions requiring ongoing authentication monitoring';