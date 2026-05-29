import { Pool } from "pg";
import dotenv from "dotenv";
import path from "path";

// Ensure NODE_ENV is 'test' before any app modules are loaded.
// This triggers the .env.test branch in src/config/env.ts.
process.env.NODE_ENV = "test";

// Load test environment variables
dotenv.config({ path: path.resolve(process.cwd(), ".env.test") });

// Create a separate test database connection pool
export const testPool = new Pool({
  connectionString: process.env.DATABASE_URL_TEST || process.env.DATABASE_URL,
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || "5432"),
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
    console.log("🔄 Initializing test database...");

    // Required for gen_random_uuid()
    await testPool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

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

    // Create wallets table
    await testPool.query(`
      CREATE TABLE IF NOT EXISTS wallets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        stellar_public_key VARCHAR(56) NOT NULL UNIQUE,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        
        CONSTRAINT wallets_status_check CHECK (status IN ('active', 'inactive', 'suspended')),
        CONSTRAINT wallets_stellar_key_format CHECK (stellar_public_key ~ '^G[A-Z2-7]{55}$')
      );

      CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id);
      CREATE INDEX IF NOT EXISTS idx_wallets_stellar_key ON wallets(stellar_public_key);
      CREATE INDEX IF NOT EXISTS idx_wallets_status ON wallets(status);
    `);

    // Create payout_requests table
    await testPool.query(`
      CREATE TABLE IF NOT EXISTS payout_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount DECIMAL(20, 7) NOT NULL,
        asset_code VARCHAR(12) NOT NULL DEFAULT 'XLM',
        asset_issuer VARCHAR(56),
        destination_address VARCHAR(56) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        memo VARCHAR(28),
        requested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        processed_at TIMESTAMP WITH TIME ZONE,
        transaction_hash VARCHAR(64),
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_payout_requests_user_id ON payout_requests(user_id);
      CREATE INDEX IF NOT EXISTS idx_payout_requests_status ON payout_requests(status);
      CREATE INDEX IF NOT EXISTS idx_payout_requests_requested_at ON payout_requests(requested_at);
      CREATE INDEX IF NOT EXISTS idx_payout_requests_transaction_hash ON payout_requests(transaction_hash);
    `);

    // Create wallet_events table
    await testPool.query(`
      CREATE TABLE IF NOT EXISTS wallet_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        event_type VARCHAR(50) NOT NULL,
        metadata JSONB DEFAULT '{}'::jsonb,
        ip_address VARCHAR(45),
        user_agent TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_wallet_events_user_id ON wallet_events(user_id);
      CREATE INDEX IF NOT EXISTS idx_wallet_events_event_type ON wallet_events(event_type);
      CREATE INDEX IF NOT EXISTS idx_wallet_events_created_at ON wallet_events(created_at);
      CREATE INDEX IF NOT EXISTS idx_wallet_events_user_type ON wallet_events(user_id, event_type);
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

    // Create refresh_tokens table
    await testPool.query(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash VARCHAR(255) NOT NULL,
          family_id UUID NOT NULL,
          device_fingerprint VARCHAR(255),
          expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
          revoked_at TIMESTAMP WITH TIME ZONE,
          replaced_by UUID REFERENCES refresh_tokens(id),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family_id ON refresh_tokens(family_id);
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
    `);

    // Create token_blacklist table
    await testPool.query(`
      CREATE TABLE IF NOT EXISTS token_blacklist (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          token_jti VARCHAR(255) NOT NULL UNIQUE,
          expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_token_blacklist_jti ON token_blacklist(token_jti);
    `);

    console.log("✅ Test database initialized successfully");
  } catch (error) {
    console.error("❌ Failed to initialize test database:", error);
    throw error;
  }
}

/**
 * Truncate all tables to reset database state between tests
 */
export async function truncateAllTables(): Promise<void> {
  try {
    await testPool.query(`
      TRUNCATE TABLE wallet_events CASCADE;
      TRUNCATE TABLE payout_requests CASCADE;
      TRUNCATE TABLE wallets CASCADE;
      TRUNCATE TABLE sessions CASCADE;
      TRUNCATE TABLE disputes CASCADE;
      TRUNCATE TABLE transactions CASCADE;
      TRUNCATE TABLE audit_logs CASCADE;
      TRUNCATE TABLE refresh_tokens CASCADE;
      TRUNCATE TABLE token_blacklist CASCADE;
      TRUNCATE TABLE users CASCADE;
    `);
  } catch (error) {
    console.error("Failed to truncate tables:", error);
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
      DROP TABLE IF EXISTS refresh_tokens CASCADE;
      DROP TABLE IF EXISTS token_blacklist CASCADE;
      DROP TABLE IF EXISTS users CASCADE;
    `);
  } catch (error) {
    console.error("Failed to drop tables:", error);
    throw error;
  }
}

/**
 * Close the test database connection
 */
export async function closeTestDatabase(): Promise<void> {
  try {
    await testPool.end();
    console.log("✅ Test database connections closed");
  } catch (error) {
    console.error("Failed to close test database:", error);
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
