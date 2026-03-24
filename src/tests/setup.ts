import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

// Load test environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.test') });

// Create a separate test database connection pool
export const testPool = new Pool({
  connectionString: process.env.DATABASE_URL_TEST || process.env.DATABASE_URL,
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

/**
 * Initialize the test database by creating all required tables
 */
export async function initializeTestDatabase(): Promise<void> {
  try {
    console.log('🔄 Initializing test database...');

    // Create users table first (referenced by other tables)
    await testPool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'user',
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        bio TEXT,
        avatar_url VARCHAR(500),
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
    `);

    // Create audit_logs table
    await testPool.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        level VARCHAR(20) NOT NULL,
        action VARCHAR(100) NOT NULL,
        message TEXT NOT NULL,
        user_id UUID REFERENCES users(id),
        entity_type VARCHAR(100),
        entity_id VARCHAR(255),
        metadata JSONB DEFAULT '{}'::jsonb,
        ip_address VARCHAR(45),
        user_agent TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
    `);

    // Create transactions table
    await testPool.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id),
        amount DECIMAL(20, 7) NOT NULL,
        currency VARCHAR(10) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        stellar_tx_hash VARCHAR(64),
        type VARCHAR(20) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
      CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);
    `);

    // Create disputes table
    await testPool.query(`
      CREATE TABLE IF NOT EXISTS disputes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        transaction_id UUID NOT NULL REFERENCES transactions(id),
        reporter_id UUID NOT NULL REFERENCES users(id),
        reason TEXT NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'open',
        resolution_notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status);
      CREATE INDEX IF NOT EXISTS idx_disputes_transaction_id ON disputes(transaction_id);
    `);

    // Create sessions table
    await testPool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        mentor_id UUID NOT NULL REFERENCES users(id),
        mentee_id UUID NOT NULL REFERENCES users(id),
        title VARCHAR(255) NOT NULL,
        description TEXT,
        scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
        duration_minutes INTEGER NOT NULL DEFAULT 60,
        status VARCHAR(20) NOT NULL DEFAULT 'scheduled',
        meeting_link VARCHAR(500),
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_sessions_mentor_id ON sessions(mentor_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_mentee_id ON sessions(mentee_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
      CREATE INDEX IF NOT EXISTS idx_sessions_scheduled_at ON sessions(scheduled_at);
    `);

    console.log('✅ Test database initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize test database:', error);
    throw error;
  }
}

/**
 * Truncate all tables to reset database state between tests
 */
export async function truncateAllTables(): Promise<void> {
  try {
    await testPool.query(`
      TRUNCATE TABLE sessions CASCADE;
      TRUNCATE TABLE disputes CASCADE;
      TRUNCATE TABLE transactions CASCADE;
      TRUNCATE TABLE audit_logs CASCADE;
      TRUNCATE TABLE users CASCADE;
    `);
  } catch (error) {
    console.error('Failed to truncate tables:', error);
    throw error;
  }
}

/**
 * Drop all tables (for cleanup after all tests)
 */
export async function dropAllTables(): Promise<void> {
  try {
    await testPool.query(`
      DROP TABLE IF EXISTS sessions CASCADE;
      DROP TABLE IF EXISTS disputes CASCADE;
      DROP TABLE IF EXISTS transactions CASCADE;
      DROP TABLE IF EXISTS audit_logs CASCADE;
      DROP TABLE IF EXISTS users CASCADE;
    `);
  } catch (error) {
    console.error('Failed to drop tables:', error);
    throw error;
  }
}

/**
 * Close the test database connection
 */
export async function closeTestDatabase(): Promise<void> {
  try {
    await testPool.end();
    console.log('✅ Test database connections closed');
  } catch (error) {
    console.error('Failed to close test database:', error);
    throw error;
  }
}

// Global setup - runs once before all tests
beforeAll(async () => {
  await initializeTestDatabase();
}, 30000);

// Clean database before each test
beforeEach(async () => {
  await truncateAllTables();
}, 10000);

// Global teardown - runs once after all tests
afterAll(async () => {
  await closeTestDatabase();
}, 30000);
// Ensure NODE_ENV is 'test' before any modules are loaded.
// This triggers the .env.test branch in src/config/env.ts.
process.env.NODE_ENV = 'test';
