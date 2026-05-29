-- =============================================================================
-- MentorsMind Platform - Seed Data
-- Description: Sample data for development and testing
-- =============================================================================

-- Clear existing data (use with caution!)
-- TRUNCATE TABLE review_votes, review_reports, reviews, booking_notes, booking_participants, 
--   bookings, transaction_events, transactions, wallet_transactions, wallet_balances, wallets, 
--   disputes, audit_logs, users CASCADE;

-- =============================================================================
-- USERS
-- =============================================================================

-- Admin user
INSERT INTO users (
    id, email, password_hash, username, full_name, role, status,
    email_verified, stellar_public_key, stellar_account_verified
) VALUES (
    '00000000-0000-0000-0000-000000000001',
    'admin@mentorsmind.com',
    '$2a$10$YourHashedPasswordHere', -- bcrypt hash of 'admin123'
    'admin',
    'Platform Administrator',
    'admin',
    'active',
    TRUE,
    'GADMIN1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ234567890',
    TRUE
);

-- Sample Mentors
INSERT INTO users (
    id, email, password_hash, username, full_name, role, status,
    bio, hourly_rate, expertise, years_of_experience, is_available,
    email_verified, stellar_public_key, stellar_account_verified,
    average_rating, total_reviews, total_sessions_completed
) VALUES 
(
    '11111111-1111-1111-1111-111111111111',
    'sarah.johnson@example.com',
    '$2a$10$YourHashedPasswordHere',
    'sarah_johnson',
    'Sarah Johnson',
    'mentor',
    'active',
    'Senior Software Engineer with 10+ years of experience in full-stack development. Specialized in React, Node.js, and cloud architecture.',
    75.00,
    ARRAY['JavaScript', 'React', 'Node.js', 'AWS', 'System Design'],
    10,
    TRUE,
    TRUE,
    'GMENTOR1ABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDEF',
    TRUE,
    4.85,
    42,
    156
),
(
    '22222222-2222-2222-2222-222222222222',
    'michael.chen@example.com',
    '$2a$10$YourHashedPasswordHere',
    'michael_chen',
    'Michael Chen',
    'mentor',
    'active',
    'Data Science expert and ML engineer. Passionate about teaching Python, machine learning, and data visualization.',
    90.00,
    ARRAY['Python', 'Machine Learning', 'Data Science', 'TensorFlow', 'PyTorch'],
    8,
    TRUE,
    TRUE,
    'GMENTOR2ABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDEF',
    TRUE,
    4.92,
    67,
    203
),
(
    '33333333-3333-3333-3333-333333333333',
    'emily.rodriguez@example.com',
    '$2a$10$YourHashedPasswordHere',
    'emily_rodriguez',
    'Emily Rodriguez',
    'mentor',
    'active',
    'UX/UI Designer with a focus on user research and design systems. Love helping aspiring designers grow.',
    65.00,
    ARRAY['UI/UX Design', 'Figma', 'User Research', 'Design Systems', 'Prototyping'],
    6,
    TRUE,
    TRUE,
    'GMENTOR3ABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDEF',
    TRUE,
    4.78,
    35,
    98
);

-- Sample Mentees
INSERT INTO users (
    id, email, password_hash, username, full_name, role, status,
    email_verified, stellar_public_key, stellar_account_verified
) VALUES 
(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'alex.kim@example.com',
    '$2a$10$YourHashedPasswordHere',
    'alex_kim',
    'Alex Kim',
    'mentee',
    'active',
    TRUE,
    'GMENTEE1ABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDEF',
    TRUE
),
(
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'jessica.taylor@example.com',
    '$2a$10$YourHashedPasswordHere',
    'jessica_taylor',
    'Jessica Taylor',
    'mentee',
    'active',
    TRUE,
    'GMENTEE2ABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDEF',
    TRUE
);

-- =============================================================================
-- WALLETS
-- =============================================================================

-- Wallets for mentors
INSERT INTO wallets (
    id, user_id, stellar_public_key, stellar_account_id, wallet_type, status,
    native_balance, sequence_number, subentry_count
) VALUES 
(
    '11111111-1111-1111-1111-111111111111',
    '11111111-1111-1111-1111-111111111111',
    'GMENTOR1ABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDEF',
    'GMENTOR1ABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDEF',
    'user',
    'active',
    1250.5000000,
    123456789,
    2
),
(
    '22222222-2222-2222-2222-222222222222',
    '22222222-2222-2222-2222-222222222222',
    'GMENTOR2ABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDEF',
    'GMENTOR2ABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDEF',
    'user',
    'active',
    2100.7500000,
    987654321,
    1
),
(
    '33333333-3333-3333-3333-333333333333',
    '33333333-3333-3333-3333-333333333333',
    'GMENTOR3ABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDEF',
    'GMENTOR3ABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDEF',
    'user',
    'active',
    875.2500000,
    456789123,
    1
);

-- Wallets for mentees
INSERT INTO wallets (
    id, user_id, stellar_public_key, stellar_account_id, wallet_type, status,
    native_balance, sequence_number, subentry_count
) VALUES 
(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'GMENTEE1ABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDEF',
    'GMENTEE1ABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDEF',
    'user',
    'active',
    500.0000000,
    111222333,
    0
),
(
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'GMENTEE2ABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDEF',
    'GMENTEE2ABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDEF',
    'user',
    'active',
    750.0000000,
    444555666,
    0
);

-- =============================================================================
-- WALLET BALANCES
-- =============================================================================

-- Native XLM balances
INSERT INTO wallet_balances (wallet_id, asset_type, balance) VALUES
('11111111-1111-1111-1111-111111111111', 'native', 1250.5000000),
('22222222-2222-2222-2222-222222222222', 'native', 2100.7500000),
('33333333-3333-3333-3333-333333333333', 'native', 875.2500000),
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'native', 500.0000000),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'native', 750.0000000);

-- =============================================================================
-- BOOKINGS
-- =============================================================================

-- Completed booking
INSERT INTO bookings (
    id, mentee_id, mentor_id, title, description, session_type,
    scheduled_start, scheduled_end, status, payment_status,
    amount, currency, platform_fee, mentor_payout,
    completed_at
) VALUES (
    'b0000001-0000-0000-0000-000000000001',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111',
    'React Hooks Deep Dive',
    'Learn advanced React hooks patterns and custom hooks development',
    'video_call',
    NOW() - INTERVAL '7 days',
    NOW() - INTERVAL '7 days' + INTERVAL '1 hour',
    'completed',
    'released',
    75.00,
    'XLM',
    3.75,
    71.25,
    NOW() - INTERVAL '7 days' + INTERVAL '1 hour'
);

-- Upcoming booking
INSERT INTO bookings (
    id, mentee_id, mentor_id, title, description, session_type,
    scheduled_start, scheduled_end, status, payment_status,
    amount, currency, platform_fee, mentor_payout
) VALUES (
    'b0000002-0000-0000-0000-000000000002',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '22222222-2222-2222-2222-222222222222',
    'Introduction to Machine Learning',
    'Basics of ML algorithms and practical applications',
    'video_call',
    NOW() + INTERVAL '2 days',
    NOW() + INTERVAL '2 days' + INTERVAL '1.5 hours',
    'confirmed',
    'held_in_escrow',
    90.00,
    'XLM',
    4.50,
    85.50
);

-- =============================================================================
-- TRANSACTIONS
-- =============================================================================

-- Deposit transaction
INSERT INTO transactions (
    id, user_id, wallet_id, type, status, amount, currency,
    stellar_tx_hash, stellar_ledger_sequence, from_address, to_address,
    completed_at
) VALUES (
    't0000001-0000-0000-0000-000000000001',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'deposit',
    'completed',
    500.0000000,
    'XLM',
    'abc123def456ghi789jkl012mno345pqr678stu901vwx234yz567890abcdef12',
    12345678,
    'GMENTEE1ABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDEF',
    'GMENTEE1ABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDEF',
    NOW() - INTERVAL '10 days'
);

-- Payment transaction for completed booking
INSERT INTO transactions (
    id, user_id, wallet_id, type, status, amount, currency,
    stellar_tx_hash, stellar_ledger_sequence, booking_id,
    from_address, to_address, platform_fee, network_fee,
    completed_at
) VALUES (
    't0000002-0000-0000-0000-000000000002',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'payment',
    'completed',
    75.0000000,
    'XLM',
    'def456ghi789jkl012mno345pqr678stu901vwx234yz567890abcdef123456',
    12345679,
    'b0000001-0000-0000-0000-000000000001',
    'GMENTEE1ABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDEF',
    'GMENTOR1ABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDEF',
    3.7500000,
    0.0001000,
    NOW() - INTERVAL '7 days'
);

-- =============================================================================
-- REVIEWS
-- =============================================================================

-- Review for completed booking
INSERT INTO reviews (
    id, booking_id, reviewer_id, reviewee_id, rating,
    title, comment, communication_rating, professionalism_rating,
    knowledge_rating, punctuality_rating
) VALUES (
    'r0000001-0000-0000-0000-000000000001',
    'b0000001-0000-0000-0000-000000000001',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111',
    5,
    'Excellent React Mentor!',
    'Sarah is an amazing mentor! She explained React hooks concepts clearly and provided practical examples. Highly recommended!',
    5,
    5,
    5,
    5
);

-- =============================================================================
-- SYSTEM CONFIGS
-- =============================================================================

INSERT INTO system_configs (key, value) VALUES
('platform_fee_percentage', '5'),
('min_booking_duration_minutes', '30'),
('max_booking_duration_minutes', '180'),
('cancellation_window_hours', '24'),
('stellar_network', '"testnet"'),
('platform_wallet_public_key', '"GPLATFORM1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ234"');

-- =============================================================================
-- AUDIT LOGS
-- =============================================================================

INSERT INTO audit_logs (level, action, message, user_id, entity_type, entity_id) VALUES
('info', 'user.created', 'New user registered', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'user', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
('info', 'booking.created', 'New booking created', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'booking', 'b0000001-0000-0000-0000-000000000001'),
('info', 'booking.completed', 'Booking completed successfully', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'booking', 'b0000001-0000-0000-0000-000000000001');

-- =============================================================================
-- VERIFICATION
-- =============================================================================

-- Verify data insertion
SELECT 'Users created: ' || COUNT(*) FROM users;
SELECT 'Wallets created: ' || COUNT(*) FROM wallets;
SELECT 'Bookings created: ' || COUNT(*) FROM bookings;
SELECT 'Transactions created: ' || COUNT(*) FROM transactions;
SELECT 'Reviews created: ' || COUNT(*) FROM reviews;

-- =============================================================================
-- END OF SEED DATA
-- =============================================================================
