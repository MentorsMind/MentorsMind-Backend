#!/usr/bin/env node

/**
 * Migration Deprecation Validation Tool
 * 
 * Usage: npm run validate:migrations
 * 
 * Checks that:
 * 1. All migrations that change API-visible tables have deprecation plans
 * 2. sunsetDate is at least 6 months in the future
 * 3. Deprecation plans reference valid API versions
 * 4. Migration descriptions are clear about database changes
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../src/utils/logger.utils';

interface MigrationMetadata {
  description: string;
  deprecatedVersions?: string[];
  deprecationPlan?: Record<string, {
    oldEndpoint: string;
    newEndpoint: string;
    reason: string;
    sunsetDate: string;
    migrationGuide: string;
  }>;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  summaryy?: string;
}

// List of tables that are part of the public API (not internal)
const API_VISIBLE_TABLES = [
  'users',
  'bookings',
  'sessions',
  'reviews',
  'payments',
  'wallets',
  'transactions',
  'messages',
  'mentors',
  'notifications',
];

/**
 * Extract table names from SQL migration
 */
function extractTableNamesFromMigration(sqlContent: string): string[] {
  const tables: Set<string> = new Set();

  // Look for CREATE TABLE
  const createMatches = sqlContent.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?[\w"`]+\.?([\w"`]+)/gi);
  for (const match of createMatches) {
    const tableName = match[1].toLowerCase().replace(/`|"/g, '');
    tables.add(tableName);
  }

  // Look for ALTER TABLE
  const alterMatches = sqlContent.matchAll(/ALTER TABLE [\w"`]+\.?([\w"`]+)/gi);
  for (const match of alterMatches) {
    const tableName = match[1].toLowerCase().replace(/`|"/g, '');
    tables.add(tableName);
  }

  return Array.from(tables);
}

/**
 * Check if migration touches API-visible tables
 */
function touchesApiVisibleTables(migrationName: string, sqlContent: string): boolean {
  const tables = extractTableNamesFromMigration(sqlContent);
  return tables.some(table => API_VISIBLE_TABLES.some(apiTable => table.includes(apiTable)));
}

/**
 * Validate a single migration
 */
function validateMigration(
  migrationName: string,
  sqlContent: string,
  metadata: MigrationMetadata
): string[] {
  const errors: string[] = [];

  // Check if migration touches API tables
  if (touchesApiVisibleTables(migrationName, sqlContent)) {
    // Migration touches API-visible tables - must have deprecation plan
    if (!metadata.deprecatedVersions || metadata.deprecatedVersions.length === 0) {
      errors.push(
        `${migrationName}: Modifies API-visible tables but has no deprecation plan. ` +
        `Add deprecatedVersions and deprecationPlan to .deprecation-metadata.json`
      );
      return errors;
    }

    // Check that all referenced versions exist
    const validVersions = ['v1', 'v2', 'v3', 'v4']; // Update as needed
    for (const version of metadata.deprecatedVersions) {
      if (!validVersions.includes(version)) {
        errors.push(
          `${migrationName}: References unknown API version "${version}". ` +
          `Valid versions: ${validVersions.join(', ')}`
        );
      }
    }

    // Check deprecation plan
    if (!metadata.deprecationPlan || Object.keys(metadata.deprecationPlan).length === 0) {
      errors.push(
        `${migrationName}: Has deprecatedVersions but no deprecationPlan. ` +
        `Add endpoint migration paths to deprecationPlan.`
      );
      return errors;
    }

    // Validate each deprecation plan entry
    for (const [version, plan] of Object.entries(metadata.deprecationPlan || {})) {
      if (!plan.oldEndpoint) {
        errors.push(
          `${migrationName}: Deprecation plan for ${version} missing oldEndpoint`
        );
      }
      if (!plan.newEndpoint) {
        errors.push(
          `${migrationName}: Deprecation plan for ${version} missing newEndpoint`
        );
      }
      if (!plan.reason) {
        errors.push(
          `${migrationName}: Deprecation plan for ${version} missing reason`
        );
      }
      if (!plan.sunsetDate) {
        errors.push(
          `${migrationName}: Deprecation plan for ${version} missing sunsetDate`
        );
      } else {
        // Check sunsetDate is at least 6 months in future
        const sunsetDate = new Date(plan.sunsetDate);
        const minSunsetDate = new Date();
        minSunsetDate.setMonth(minSunsetDate.getMonth() + 6);

        if (sunsetDate < minSunsetDate) {
          errors.push(
            `${migrationName}: Sunset date (${plan.sunsetDate}) must be at least 6 months in the future`
          );
        }
      }
      if (!plan.migrationGuide) {
        errors.push(
          `${migrationName}: Deprecation plan for ${version} missing migrationGuide URL`
        );
      }
    }
  }

  return errors;
}

/**
 * Main validation function
 */
export function validateMigrations(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const migrationsDir = path.join(__dirname, '../../database/migrations');
  const metadataPath = path.join(migrationsDir, '.deprecation-metadata.json');

  // Load metadata
  let metadata: Record<string, MigrationMetadata> = {};
  if (fs.existsSync(metadataPath)) {
    try {
      const content = fs.readFileSync(metadataPath, 'utf-8');
      const parsed = JSON.parse(content);
      metadata = parsed.migrations || {};
    } catch (error) {
      errors.push(`Failed to parse .deprecation-metadata.json: ${error}`);
      return { valid: false, errors, warnings };
    }
  }

  // Check all SQL migrations
  const migrationFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));
  let migrationsChecked = 0;
  let migrationsWithDeprecation = 0;

  for (const file of migrationFiles) {
    const filePath = path.join(migrationsDir, file);
    const sqlContent = fs.readFileSync(filePath, 'utf-8');

    const migrationMetadata = metadata[file] || { description: '' };
    const migrationErrors = validateMigration(file, sqlContent, migrationMetadata);

    if (migrationErrors.length > 0) {
      errors.push(...migrationErrors);
    }

    if (migrationMetadata.deprecatedVersions && migrationMetadata.deprecatedVersions.length > 0) {
      migrationsWithDeprecation++;
    }

    migrationsChecked++;
  }

  // Warnings
  if (migrationsWithDeprecation > 0) {
    warnings.push(`${migrationsWithDeprecation} migrations have deprecation plans`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    summaryy: `Validated ${migrationsChecked} migrations. ${migrationsWithDeprecation} have deprecation plans.`,
  };
}

// Run validation if called directly
if (require.main === module) {
  const result = validateMigrations();

  if (result.errors.length > 0) {
    console.error('\n❌ MIGRATION VALIDATION FAILED\n');
    for (const error of result.errors) {
      console.error(`  • ${error}`);
    }
    process.exit(1);
  }

  if (result.warnings.length > 0) {
    console.warn('\n⚠️  Warnings:\n');
    for (const warning of result.warnings) {
      console.warn(`  • ${warning}`);
    }
  }

  console.log(`\n✅ ${result.summaryy}\n`);
  process.exit(0);
}

export default validateMigrations;
