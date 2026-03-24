/**
 * API Versioning Configuration
 *
 * Deprecation Policy:
 * - A minimum of 3 months notice is required before removing any API version.
 * - Deprecated versions will include `Deprecation` and `Sunset` response headers.
 * - Consumers should migrate before the Sunset date to avoid service disruption.
 */

export interface VersionConfig {
  /** The version string, e.g. "v1" */
  version: string;
  /** Whether this version is currently active */
  active: boolean;
  /** ISO 8601 date when this version was deprecated (undefined = not deprecated) */
  deprecatedAt?: string;
  /** ISO 8601 date when this version will be removed (undefined = no planned removal) */
  sunsetAt?: string;
  /** Human-readable deprecation message */
  deprecationMessage?: string;
}

export const API_VERSIONS: Record<string, VersionConfig> = {
  v1: {
    version: 'v1',
    active: true,
    // Example of how to mark v1 as deprecated in the future:
    // deprecatedAt: '2026-06-01T00:00:00Z',
    // sunsetAt:     '2026-09-01T00:00:00Z',
    // deprecationMessage: 'v1 is deprecated. Please migrate to v2.',
  },
  v2: {
    version: 'v2',
    active: false, // scaffold only — not yet implemented
  },
};

/** The current default/latest stable version */
export const CURRENT_VERSION = 'v1';

/** Supported versions that can be requested via Accept-Version header */
export const SUPPORTED_VERSIONS = Object.values(API_VERSIONS)
  .filter((v) => v.active)
  .map((v) => v.version);
