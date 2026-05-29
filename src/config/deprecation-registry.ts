/**
 * API Deprecation Registry
 * 
 * Central registry of all deprecated API endpoints with their
 * sunset dates, replacement endpoints, and migration guides.
 */

import deprecationManager, { createDeprecationConfig } from '../utils/deprecation.utils';

/**
 * Register all deprecated endpoints here
 * 
 * Format:
 * - endpoint: The full endpoint path (e.g., "GET /api/v1/users/:id")
 * - replacementEndpoint: The new endpoint to use instead
 * - migrationGuide: URL to migration documentation
 * - reason: Why the endpoint is being deprecated
 * - sunsetMonths: Months until removal (default: 6)
 */

export function initializeDeprecationRegistry(): void {
  // Example: Deprecate old user endpoint
  deprecationManager.registerDeprecation(
    createDeprecationConfig('GET /api/v1/users/:id', {
      replacementEndpoint: 'GET /api/v2/users/:id',
      migrationGuide: 'https://docs.mentorminds.com/migration/v1-to-v2-users',
      reason: 'Replaced with improved v2 API with better performance',
      sunsetMonths: 6,
    })
  );

  // Example: Deprecate old booking endpoint
  deprecationManager.registerDeprecation(
    createDeprecationConfig('GET /api/v1/bookings', {
      replacementEndpoint: 'GET /api/v2/bookings',
      migrationGuide: 'https://docs.mentorminds.com/migration/v1-to-v2-bookings',
      reason: 'Consolidated into v2 API with enhanced filtering',
      sunsetMonths: 6,
    })
  );

  // Example: Deprecate old payment endpoint
  deprecationManager.registerDeprecation(
    createDeprecationConfig('POST /api/v1/payments/process', {
      replacementEndpoint: 'POST /api/v2/payments/initiate',
      migrationGuide: 'https://docs.mentorminds.com/migration/v1-to-v2-payments',
      reason: 'New payment flow with improved security and error handling',
      sunsetMonths: 6,
    })
  );

  // Example: Deprecate old session endpoint
  deprecationManager.registerDeprecation(
    createDeprecationConfig('GET /api/v1/sessions/:id', {
      replacementEndpoint: 'GET /api/v2/sessions/:id',
      migrationGuide: 'https://docs.mentorminds.com/migration/v1-to-v2-sessions',
      reason: 'Enhanced session data structure with additional metadata',
      sunsetMonths: 6,
    })
  );

  // Example: Deprecate old review endpoint
  deprecationManager.registerDeprecation(
    createDeprecationConfig('POST /api/v1/reviews', {
      replacementEndpoint: 'POST /api/v2/reviews',
      migrationGuide: 'https://docs.mentorminds.com/migration/v1-to-v2-reviews',
      reason: 'Improved review system with better rating validation',
      sunsetMonths: 6,
    })
  );

  console.log('✓ Deprecation registry initialized');
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
  const now = new Date();
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  return deprecationManager.getDeprecationStatus().filter((item) => {
    if (item.status === 'sunset') return false;
    return item.daysUntilSunset !== undefined && item.daysUntilSunset <= 30;
  });
}

/**
 * Get endpoints that have already sunset
 */
export function getSunsetEndpoints() {
  return deprecationManager.getDeprecationStatus().filter((item) => item.status === 'sunset');
}
