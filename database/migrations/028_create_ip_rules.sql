-- Up Migration
CREATE TABLE ip_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ip_range TEXT NOT NULL, -- single IP or CIDR
    rule_type TEXT NOT NULL CHECK (rule_type IN ('allow', 'block')),
    context TEXT NOT NULL CHECK (context IN ('admin', 'global')),
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ip_rules_type_context ON ip_rules(rule_type, context);
CREATE UNIQUE INDEX idx_ip_rules_range_context ON ip_rules(ip_range, context);

-- Down Migration
-- DROP TABLE ip_rules;
