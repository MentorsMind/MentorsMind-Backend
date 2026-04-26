import pool from '../config/database';
import { logger } from '../utils/logger.utils';

/**
 * Database Table Validator
 * 
 * Verifies that all required database tables exist at startup.
 * This replaces the anti-pattern of creating tables at runtime via DDL.
 * 
 * Usage: Call validateRequiredTables() during application startup
 * to ensure all migrations have been applied before serving requests.
 */

export interface TableValidationResult {
  tableName: string;
  exists: boolean;
}

export interface ValidationSummary {
  allTablesExist: boolean;
  totalTables: number;
  missingTables: string[];
  results: TableValidationResult[];
}

/**
 * List of all required tables that must exist for the application to function.
 * These should be created by migration files, not at runtime.
 */
const REQUIRED_TABLES = [
  // Core tables
  'users',
  'wallets',
  'transactions',
  'transaction_events',
  
  // Booking and session tables
  'bookings',
  'sessions',
  
  // Admin and operational tables
  'disputes',
  'dispute_evidence',
  'system_configs',
  'audit_logs',
  
  // Communication tables
  'notifications',
  'conversations',
  'messages',
  
  // Verification and goals
  'mentor_verifications',
  'goals',
  
  // Additional operational tables
  'refresh_tokens',
  'reviews',
  'push_tokens',
  'oauth_accounts',
  'user_sessions',
  'webhooks',
  'webhook_deliveries',
  'api_keys',
  'consent_records',
];

/**
 * Validates that all required database tables exist.
 * 
 * @returns Validation summary with details about missing tables
 */
export async function validateRequiredTables(): Promise<ValidationSummary> {
  const results: TableValidationResult[] = [];
  const missingTables: string[] = [];

  try {
    // Query information_schema to check which tables exist
    const query = `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name = ANY($1)
    `;
    
    const { rows } = await pool.query(query, [REQUIRED_TABLES]);
    const existingTables = new Set(rows.map((row: { table_name: string }) => row.table_name));

    // Check each required table
    for (const tableName of REQUIRED_TABLES) {
      const exists = existingTables.has(tableName);
      results.push({ tableName, exists });
      
      if (!exists) {
        missingTables.push(tableName);
      }
    }

    const allTablesExist = missingTables.length === 0;

    if (!allTablesExist) {
      logger.error('Database validation failed: missing required tables', {
        missingTables,
        totalRequired: REQUIRED_TABLES.length,
        totalFound: REQUIRED_TABLES.length - missingTables.length,
      });
    } else {
      logger.info('Database validation passed: all required tables exist', {
        totalTables: REQUIRED_TABLES.length,
      });
    }

    return {
      allTablesExist,
      totalTables: REQUIRED_TABLES.length,
      missingTables,
      results,
    };
  } catch (error) {
    logger.error('Database validation failed with error', {
      error: (error as Error).message,
    });
    
    // Return failure state
    return {
      allTablesExist: false,
      totalTables: REQUIRED_TABLES.length,
      missingTables: REQUIRED_TABLES,
      results: REQUIRED_TABLES.map((tableName) => ({
        tableName,
        exists: false,
      })),
    };
  }
}

/**
 * Checks if a specific table exists in the database.
 * 
 * @param tableName - Name of the table to check
 * @returns true if the table exists, false otherwise
 */
export async function tableExists(tableName: string): Promise<boolean> {
  try {
    const query = `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = $1
      ) AS exists
    `;
    
    const { rows } = await pool.query(query, [tableName]);
    return rows[0].exists;
  } catch (error) {
    logger.error(`Failed to check if table ${tableName} exists`, {
      error: (error as Error).message,
    });
    return false;
  }
}

export default {
  validateRequiredTables,
  tableExists,
  REQUIRED_TABLES,
};
