-- Migration: 163_create_adaptive_testing_and_question_bank.sql
-- Description: Creates adaptive_tests, question_bank, and test_responses tables for adaptive testing engine

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS adaptive_tests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(255) NOT NULL,
    skill_area VARCHAR(100) NOT NULL,
    current_difficulty INT NOT NULL DEFAULT 5 CHECK (current_difficulty >= 1 AND current_difficulty <= 10),
    questions_answered INT NOT NULL DEFAULT 0,
    correct_answers INT NOT NULL DEFAULT 0,
    estimated_level NUMERIC(5, 2) NOT NULL DEFAULT 5.0,
    is_complete BOOLEAN NOT NULL DEFAULT FALSE,
    confidence_score NUMERIC(5, 4) NOT NULL DEFAULT 0.0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_adaptive_tests_user_id ON adaptive_tests(user_id);
CREATE INDEX IF NOT EXISTS idx_adaptive_tests_skill_area ON adaptive_tests(skill_area);
CREATE INDEX IF NOT EXISTS idx_adaptive_tests_created_at ON adaptive_tests(created_at);

CREATE TABLE IF NOT EXISTS question_bank (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    skill_area VARCHAR(100) NOT NULL,
    topic VARCHAR(100) NOT NULL,
    difficulty INT NOT NULL CHECK (difficulty >= 1 AND difficulty <= 10),
    question_text TEXT NOT NULL,
    options JSONB NOT NULL,
    correct_answer TEXT NOT NULL,
    explanation TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_question_bank_skill_difficulty ON question_bank(skill_area, difficulty);
CREATE INDEX IF NOT EXISTS idx_question_bank_topic ON question_bank(topic);
CREATE INDEX IF NOT EXISTS idx_question_bank_skill_area ON question_bank(skill_area);

CREATE TABLE IF NOT EXISTS test_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    test_id UUID NOT NULL REFERENCES adaptive_tests(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES question_bank(id) ON DELETE CASCADE,
    is_correct BOOLEAN NOT NULL,
    response_time INT NOT NULL, -- response time in ms
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_test_responses_test_id ON test_responses(test_id);
CREATE INDEX IF NOT EXISTS idx_test_responses_question_id ON test_responses(question_id);

-- Alias view for backward-compatibility with services referencing adaptive_test_questions
CREATE OR REPLACE VIEW adaptive_test_questions AS 
SELECT id, test_id, question_id, is_correct, response_time, created_at 
FROM test_responses;
