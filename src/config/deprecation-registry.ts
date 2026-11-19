/**
 * API Deprecation Registry
 *
 * Central registry of all deprecated API endpoints with their
 * sunset dates, replacement endpoints, and migration guides.
 */

import deprecationManager, {
  createDeprecationConfig,
} from "../utils/deprecation.utils";
import { logger } from "../utils/logger.utils";

/**
 * Register all deprecated endpoints here
 *
 * Format:
 * - endpoint: The full endpoint path (e.g., "GET /api/v1/search/mentors").
 *   Matched literally against `${req.method} ${req.baseUrl}${req.path}`, so
 *   route params like ":id" never match.
 * - deprecatedDate: Fixed date the deprecation was announced. Always set it —
 *   without it the Sunset date is recomputed from "now" on every boot.
 * - replacementEndpoint: The new endpoint to use instead
 * - migrationGuide: URL to migration documentation
 * - reason: Why the endpoint is being deprecated
 * - sunsetMonths: Months until removal (default: 6)
 */

export function initializeDeprecationRegistry(): void {
  // v1 mentor search is superseded by v2 (SearchV2Controller) — issue #1096.
  // Headers are applied by deprecationMiddleware on the v1 /search mount only
  // (src/routes/v1/index.ts); search.routes.ts is shared with v2, so the key
  // must stay version-qualified.
  deprecationManager.registerDeprecation(
    createDeprecationConfig("GET /api/v1/search/mentors", {
      deprecatedDate: new Date("2026-09-25T00:00:00Z"),
      replacementEndpoint: "GET /api/v2/search/mentors",
      migrationGuide: "https://docs.mentorminds.com/migration/v1-to-v2-search",
      reason: "Superseded by v2 mentor search with richer filtering and ranking",
      sunsetMonths: 6,
    }),
  );

  logger.info("Deprecation registry initialized");
}

/**
 * Get all currently deprecated endpoints
 */
export function getDeprecatedEndpoints() {
  return deprecationManager.getDeprecationStatus();
}

/**
 * Get endpoints that are about to sunset (within 30 days)
 */
export function getUpcomingSunsets() {
  return deprecationManager.getDeprecationStatus().filter((item) => {
    if (item.status === "sunset") return false;
    return item.daysUntilSunset !== undefined && item.daysUntilSunset <= 30;
  });
}

/**
 * Get endpoints that have already sunset
 */
export function getSunsetEndpoints() {
  return deprecationManager
    .getDeprecationStatus()
    .filter((item) => item.status === "sunset");
}
