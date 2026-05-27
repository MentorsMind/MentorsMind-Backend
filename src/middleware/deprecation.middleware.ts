/**
 * Deprecation Middleware
 * 
 * Middleware for handling deprecated API endpoints with proper
 * headers, warnings, and sunset enforcement.
 */

import { Request, Response, NextFunction } from 'express';
import deprecationManager from '../utils/deprecation.utils';
import { logWarning } from '../utils/error.utils';

/**
 * Middleware to add deprecation headers to responses
 * 
 * Usage:
 * router.get('/api/v1/users/:id', deprecationMiddleware, handler);
 */
export function deprecationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const endpoint = `${req.method} ${req.baseUrl}${req.path}`;

  // Check if endpoint is sunset (should be removed)
  if (deprecationManager.shouldBeRemoved(endpoint)) {
    const deprecation = deprecationManager.getDeprecation(endpoint);

    res.status(410).json({
      error: 'Gone',
      message: `This API endpoint has been permanently removed as of ${deprecation?.sunsetDate.toISOString()}`,
      replacementEndpoint: deprecation?.replacementEndpoint,
      migrationGuide: deprecation?.migrationGuide,
      documentation: 'https://docs.mentorminds.com/api/deprecation',
    });

    logWarning(`Sunset endpoint accessed: ${endpoint}`, {
      replacementEndpoint: deprecation?.replacementEndpoint,
      clientIp: req.ip,
      userAgent: req.get('user-agent'),
    });

    return;
  }

  // Check if endpoint is deprecated
  const deprecation = deprecationManager.getDeprecation(endpoint);
  if (deprecation) {
    // Add Deprecation header (RFC 8594)
    res.set('Deprecation', 'true');

    // Add Sunset header with removal date
    res.set('Sunset', deprecation.sunsetDate.toUTCString());

    // Add Link header pointing to replacement endpoint
    if (deprecation.replacementEndpoint) {
      res.set(
        'Link',
        `<${deprecation.replacementEndpoint}>; rel="successor-version"`
      );
    }

    // Add custom header with migration guide
    if (deprecation.migrationGuide) {
      res.set('X-API-Migration-Guide', deprecation.migrationGuide);
    }

    // Add Warning header (RFC 7234)
    const daysUntilSunset = Math.ceil(
      (deprecation.sunsetDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
    );
    const warningMessage = `API endpoint deprecated. Will be removed in ${daysUntilSunset} days (${deprecation.sunsetDate.toISOString()})`;
    res.set('Warning', `299 - "${warningMessage}"`);

    // Add X-API-Warn header for additional context
    res.set('X-API-Warn', `Deprecated endpoint. Use ${deprecation.replacementEndpoint || 'new endpoint'} instead`);

    // Log deprecation usage
    logWarning(`Deprecated endpoint accessed: ${endpoint}`, {
      replacementEndpoint: deprecation.replacementEndpoint,
      sunsetDate: deprecation.sunsetDate.toISOString(),
      daysUntilSunset,
      clientIp: req.ip,
      userAgent: req.get('user-agent'),
    });
  }

  next();
}

/**
 * Middleware to warn about upcoming sunsets
 * Logs warnings for endpoints that will sunset within 30 days
 */
export function sunsetWarningMiddleware(req: Request, res: Response, next: NextFunction): void {
  const endpoint = `${req.method} ${req.baseUrl}${req.path}`;
  const deprecation = deprecationManager.getDeprecation(endpoint);

  if (deprecation) {
    const daysUntilSunset = Math.ceil(
      (deprecation.sunsetDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
    );

    // Warn if sunset is within 30 days
    if (daysUntilSunset <= 30 && daysUntilSunset > 0) {
      logWarning(`Endpoint sunset imminent: ${endpoint}`, {
        daysUntilSunset,
        sunsetDate: deprecation.sunsetDate.toISOString(),
        replacementEndpoint: deprecation.replacementEndpoint,
      });
    }
  }

  next();
}

/**
 * Middleware to track deprecated endpoint usage
 * Useful for analytics and understanding migration progress
 */
export function deprecationTrackingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const endpoint = `${req.method} ${req.baseUrl}${req.path}`;

  if (deprecationManager.isDeprecated(endpoint)) {
    // Track in your analytics system
    // Example: analytics.track('deprecated_endpoint_accessed', {
    //   endpoint,
    //   userId: req.user?.id,
    //   timestamp: new Date(),
    // });

    // Add tracking header
    res.set('X-Deprecated-Endpoint', 'true');
  }

  next();
}

/**
 * Middleware to enforce strict deprecation (return 410 immediately)
 * Use this for endpoints that are in their final days before sunset
 */
export function strictDeprecationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const endpoint = `${req.method} ${req.baseUrl}${req.path}`;
  const deprecation = deprecationManager.getDeprecation(endpoint);

  if (deprecation) {
    const daysUntilSunset = Math.ceil(
      (deprecation.sunsetDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
    );

    // Return 410 if sunset is within 7 days
    if (daysUntilSunset <= 7) {
      res.status(410).json({
        error: 'Gone',
        message: `This API endpoint will be removed on ${deprecation.sunsetDate.toISOString()}`,
        replacementEndpoint: deprecation.replacementEndpoint,
        migrationGuide: deprecation.migrationGuide,
        daysUntilRemoval: daysUntilSunset,
      });

      return;
    }
  }

  next();
}

/**
 * Middleware to add deprecation info to response body
 * Useful for debugging and client-side handling
 */
export function deprecationInfoMiddleware(req: Request, res: Response, next: NextFunction): void {
  const endpoint = `${req.method} ${req.baseUrl}${req.path}`;
  const deprecation = deprecationManager.getDeprecation(endpoint);

  if (deprecation) {
    // Store deprecation info for use in route handlers
    (req as any).deprecation = {
      isDeprecated: true,
      sunsetDate: deprecation.sunsetDate,
      replacementEndpoint: deprecation.replacementEndpoint,
      migrationGuide: deprecation.migrationGuide,
      reason: deprecation.reason,
    };
  }

  next();
}
