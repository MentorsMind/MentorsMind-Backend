CREATE TABLE IF NOT EXISTS learner_goals (
    id SERIAL PRIMARY KEY,
    learner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    goal_title VARCHAR(255) NOT NULL,
    target_date DATE,
    status VARCHAR(50) DEFAULT 'in_progress', -- in_progress, completed, abandoned
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS learner_progress (
    id SERIAL PRIMARY KEY,
    learner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    total_sessions INTEGER DEFAULT 0,
    total_hours_spent DECIMAL(10, 2) DEFAULT 0,
    skills_covered TEXT[],
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
