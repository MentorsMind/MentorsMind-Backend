#!/usr/bin/env node

/**
 * API Sunset Validation Script
 *
 * Pre-deployment check to ensure:
 * 1. No API versions have sunset without being marked inactive
 * 2. All sunset dates are valid ISO 8601 dates
 * 3. Database migrations don't support sunset API versions
 * 4. Warns about upcoming sunsets
 *
 * Run during CI/CD before deployment to prevent serving sunset APIs
 *
 * Usage:
 *   npx ts-node scripts/validate-api-sunsets.ts
 *   npm run validate:api-sunsets
 */

import { API_VERSIONS } from "../src/config/api-versions.config";
import * as fs from "fs";
import * as path from "path";

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  criticalVersions: Array<{
    version: string;
    daysUntilSunset: number;
    status: string;
  }>;
}

const result: ValidationResult = {
  valid: true,
  errors: [],
  warnings: [],
  criticalVersions: [],
};

/**
 * Check if a date string is valid ISO 8601 format
 */
function isValidISODate(dateStr: string): boolean {
  if (typeof dateStr !== "string") return false;
  const date = new Date(dateStr);
  return date instanceof Date && !isNaN(date.getTime()) && dateStr === date.toISOString();
}

/**
 * Parse ISO date and return days until that date
 */
function getDaysUntil(dateStr: string): number {
  const targetDate = new Date(dateStr);
  const now = new Date();
  return Math.ceil((targetDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Validate API version configurations
 */
function validateVersionConfigs(): void {
  console.log("\n📋 Validating API version configurations...\n");

  const now = new Date();
  const versions = Object.entries(API_VERSIONS);

  if (versions.length === 0) {
    result.errors.push("No API versions defined in api-versions.config.ts");
    return;
  }

  versions.forEach(([version, config]) => {
    console.log(`  Checking ${version}...`);

    // Check that version string matches key
    if (config.version !== version) {
      result.errors.push(
        `Version mismatch: key is "${version}" but config.version is "${config.version}"`
      );
      result.valid = false;
    }

    // Validate deprecatedAt format if present
    if (config.deprecatedAt && !isValidISODate(config.deprecatedAt)) {
      result.errors.push(
        `Invalid deprecatedAt date format for ${version}: "${config.deprecatedAt}". Must be valid ISO 8601.`
      );
      result.valid = false;
    }

    // Validate sunsetAt format if present
    if (config.sunsetAt && !isValidISODate(config.sunsetAt)) {
      result.errors.push(
        `Invalid sunsetAt date format for ${version}: "${config.sunsetAt}". Must be valid ISO 8601.`
      );
      result.valid = false;
    }

    // Check sunset date ordering
    if (config.deprecatedAt && config.sunsetAt) {
      const deprecatedDate = new Date(config.deprecatedAt);
      const sunsetDate = new Date(config.sunsetAt);

      if (deprecatedDate >= sunsetDate) {
        result.errors.push(
          `Invalid dates for ${version}: deprecatedAt (${config.deprecatedAt}) must be before sunsetAt (${config.sunsetAt})`
        );
        result.valid = false;
      }

      // Warn if sunset is too soon (less than 30 days from deprecation)
      const daysBetween = Math.ceil(
        (sunsetDate.getTime() - deprecatedDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (daysBetween < 90) {
        result.warnings.push(
          `${version}: Sunset is only ${daysBetween} days after deprecation. Consider increasing to at least 90 days.`
        );
      }
    }

    // CRITICAL: Check if version has sunset but is still marked active
    if (config.sunsetAt) {
      const sunsetDate = new Date(config.sunsetAt);
      const isSunset = now > sunsetDate;

      if (isSunset && config.active) {
        result.errors.push(
          `CRITICAL: ${version} has passed sunsetAt (${config.sunsetAt}) but is still marked active=true. This violates sunset enforcement.`
        );
        result.valid = false;
      }

      const daysUntilSunset = getDaysUntil(config.sunsetAt);

      // Sunset has passed
      if (isSunset) {
        result.errors.push(
          `CRITICAL: ${version} has already sunset (${Math.abs(daysUntilSunset)} days overdue). Mark as active=false immediately.`
        );
        result.valid = false;
        result.criticalVersions.push({
          version,
          daysUntilSunset,
          status: "SUNSET",
        });
      }
      // Critical period: 0-7 days
      else if (daysUntilSunset <= 7) {
        result.warnings.push(
          `CRITICAL: ${version} will sunset in ${daysUntilSunset} days (${config.sunsetAt}). Plan for immediate deactivation.`
        );
        result.criticalVersions.push({
          version,
          daysUntilSunset,
          status: "CRITICAL-7DAYS",
        });
      }
      // Warning period: 7-30 days
      else if (daysUntilSunset <= 30) {
        result.warnings.push(
          `${version} will sunset in ${daysUntilSunset} days (${config.sunsetAt}). Ensure clients have migrated.`
        );
      }
    }
  });
}

/**
 * Validate that no migrations reference sunset APIs
 */
function validateMigrationsSunsetCompliance(): void {
  console.log("\n🗄️  Validating database migrations...\n");

  const migrationsDir = path.join(__dirname, "../database/migrations");

  if (!fs.existsSync(migrationsDir)) {
    result.warnings.push("Migrations directory not found. Skipping migration validation.");
    return;
  }

  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql") || f.endsWith(".ts"));

  if (migrationFiles.length === 0) {
    console.log("  No migrations found.");
    return;
  }

  // Get sunset versions
  const sunsetVersions = Object.entries(API_VERSIONS)
    .filter(([, config]) => {
      if (!config.sunsetAt) return false;
      return new Date() > new Date(config.sunsetAt);
    })
    .map(([version]) => version);

  if (sunsetVersions.length === 0) {
    console.log("  No sunset API versions to check.");
    return;
  }

  // Check each migration for references to sunset APIs
  migrationFiles.forEach((file) => {
    const content = fs.readFileSync(path.join(migrationsDir, file), "utf-8");

    sunsetVersions.forEach((version) => {
      // Look for references to sunset API version in path patterns
      if (
        content.includes(`/api/${version}/`) ||
        content.includes(`"${version}"`) ||
        content.includes(`'${version}'`)
      ) {
        result.warnings.push(
          `Migration ${file} may contain reference to sunset API version ${version}. Review for cleanup opportunities.`
        );
      }
    });
  });
}

/**
 * Check database support for deprecated endpoints
 */
function validateDatabaseSchemaForDeprecatedEndpoints(): void {
  console.log("\n💾 Checking database schema for deprecated endpoint support...\n");

  // This is a placeholder for checking if database schema still supports
  // deprecated endpoints. In practice, you'd query the database to see
  // if there are tables/columns that were ONLY added for deprecated APIs.

  const deprecatedVersions = Object.entries(API_VERSIONS)
    .filter(([, config]) => config.deprecatedAt && !config.sunsetAt)
    .map(([version]) => version);

  if (deprecatedVersions.length === 0) {
    console.log("  No deprecated (non-sunset) versions found.");
    return;
  }

  console.log(
    `  Found ${deprecatedVersions.length} deprecated versions. After sunset, plan database cleanup.`
  );
}

/**
 * Generate deployment recommendations
 */
function generateRecommendations(): void {
  if (result.criticalVersions.length > 0) {
    console.log("\n⚠️  DEPLOYMENT ACTIONS REQUIRED:\n");

    result.criticalVersions.forEach(({ version, daysUntilSunset, status }) => {
      if (status === "SUNSET") {
        console.log(
          `  🛑 ${version}: ALREADY SUNSET (${Math.abs(daysUntilSunset)} days overdue)`
        );
        console.log(
          `     Action: Remove from API_VERSIONS and set active=false immediately`
        );
      } else if (status === "CRITICAL-7DAYS") {
        console.log(`  ⏰ ${version}: Sunset in ${daysUntilSunset} days`);
        console.log(`     Action: Prepare for immediate deactivation`);
      }
    });
  }
}

/**
 * Main validation function
 */
function main(): void {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("🔍 API Sunset Validation");
  console.log("═══════════════════════════════════════════════════════════");

  validateVersionConfigs();
  validateMigrationsSunsetCompliance();
  validateDatabaseSchemaForDeprecatedEndpoints();

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("📊 VALIDATION RESULTS");
  console.log("═══════════════════════════════════════════════════════════\n");

  if (result.errors.length > 0) {
    console.log(`❌ ERRORS (${result.errors.length}):\n`);
    result.errors.forEach((error) => {
      console.log(`  • ${error}`);
    });
    console.log();
  }

  if (result.warnings.length > 0) {
    console.log(`⚠️  WARNINGS (${result.warnings.length}):\n`);
    result.warnings.forEach((warning) => {
      console.log(`  • ${warning}`);
    });
    console.log();
  }

  if (result.errors.length === 0 && result.warnings.length === 0) {
    console.log("✅ All validations passed!\n");
  }

  generateRecommendations();

  console.log("\n═══════════════════════════════════════════════════════════");

  // Exit with appropriate code
  if (!result.valid) {
    console.error("\n❌ VALIDATION FAILED - Deployment blocked\n");
    process.exit(1);
  }

  if (result.criticalVersions.length > 0) {
    console.warn(
      "\n⚠️  Critical sunset periods detected. Review and confirm before deploying.\n"
    );
    process.exit(0); // Don't block, but warn
  }

  console.log("✅ Ready for deployment\n");
  process.exit(0);
}

main();
