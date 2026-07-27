/**
 * API Versioning Configuration
 *
 * ⚠️  CRITICAL: Sunset Enforcement Policy
 *
 * After sunsetAt passes, ALL requests to that version receive HTTP 410 Gone.
 * This is MANDATORY enforcement - not optional warnings.
 *
 * Timeline:
 * 1. deprecatedAt: Version marked deprecated, clients see warning headers
 * 2. sunsetAt (30 days before): Strict warnings added to all responses
 * 3. sunsetAt (7 days before): 410 Gone for ALL requests
 * 4. sunsetAt (passed): 410 Gone - version is completely removed
 *
 * Minimum Notice: 6 months (enforced by deprecation-registry)
 * Deployment: CI check prevents deployment if migrations lack deprecation plan
 */

export interface VersionConfig {
  /** The version string, e.g. "v1" */
  version: string;
  /** Whether this version is currently active (not sunset) */
  active: boolean;
  /** ISO 8601 date when this version was deprecated (clients see warnings) */
  deprecatedAt?: string;
  /** ISO 8601 date when this version MUST be migrated from (410 enforced after this) */
  sunsetAt?: string;
  /** Human-readable deprecation message for API docs */
  deprecationMessage?: string;
  /** Migration guide URL */
  migrationGuide?: string;
}

export const API_VERSIONS: Record<string, VersionConfig> = {
  v1: {
    version: 'v1',
    active: true,
    // EXAMPLE: To deprecate v1, do this:
    // 1. Set deprecatedAt to today (clients get warning headers)
    // 2. Set sunsetAt to 6 months from now
    // 3. Update database migrations with deprecation metadata
    // 4. Deploy - CI will check everything is documented
    // 5. Clients have 6 months to migrate
    //
    // deprecatedAt: '2026-06-01T00:00:00Z',
    // sunsetAt: '2026-12-01T00:00:00Z',
    // deprecationMessage: 'v1 is deprecated. Please migrate to v2.',
    // migrationGuide: 'https://docs.mentorminds.com/migration/v1-to-v2',
  },
  v2: {
    version: 'v2',
    active: true,
  },
};

/** The current default/latest stable version */
export const CURRENT_VERSION = 'v1';

/** Supported versions that can be requested via Accept-Version header */
export const SUPPORTED_VERSIONS = Object.values(API_VERSIONS)
  .filter((v) => v.active)
  .map((v) => v.version);

/**
 * DEPRECATION ENFORCEMENT
 * 
 * This is automatically checked by:
 * 1. sunsetEnforcementMiddleware - blocks requests after sunsetAt
 * 2. CI pre-deployment check - prevents deploying without migration documentation
 * 3. Deprecation registry - tracks all deprecated endpoints
 */
