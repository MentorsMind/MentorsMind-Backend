/**
 * Deprecation Management Routes
 * 
 * Admin endpoints for managing API deprecations, viewing status,
 * and tracking migration progress.
 */

import { Router, Request, Response } from 'express';
import deprecationManager from '../../utils/deprecation.utils';
import {
  getDeprecatedEndpoints,
  getUpcomingSunsets,
  getSunsetEndpoints,
} from '../../config/deprecation-registry';

const router = Router();

/**
 * GET /admin/deprecations
 * Get all deprecated endpoints with their status
 */
router.get('/deprecations', (req: Request, res: Response) => {
  const status = deprecationManager.getDeprecationStatus();

  res.json({
    total: status.length,
    deprecated: status.filter((s) => s.status === 'deprecated').length,
    sunset: status.filter((s) => s.status === 'sunset').length,
    endpoints: status,
  });
});

/**
 * GET /admin/deprecations/upcoming
 * Get endpoints that will sunset within 30 days
 */
router.get('/deprecations/upcoming', (req: Request, res: Response) => {
  const upcoming = getUpcomingSunsets();

  res.json({
    count: upcoming.length,
    endpoints: upcoming,
    message:
      upcoming.length > 0
        ? `${upcoming.length} endpoint(s) will sunset within 30 days`
        : 'No endpoints scheduled for sunset in the next 30 days',
  });
});

/**
 * GET /admin/deprecations/sunset
 * Get endpoints that have already sunset
 */
router.get('/deprecations/sunset', (req: Request, res: Response) => {
  const sunset = getSunsetEndpoints();

  res.json({
    count: sunset.length,
    endpoints: sunset,
    message:
      sunset.length > 0
        ? `${sunset.length} endpoint(s) have been removed`
        : 'No endpoints have been removed yet',
  });
});

/**
 * GET /admin/deprecations/:endpoint
 * Get details for a specific deprecated endpoint
 */
router.get('/deprecations/:endpoint', (req: Request, res: Response) => {
  const endpoint = req.params.endpoint;
  const deprecation = deprecationManager.getDeprecation(endpoint);

  if (!deprecation) {
    return res.status(404).json({
      error: 'Not Found',
      message: `Endpoint "${endpoint}" is not deprecated`,
    });
  }

  const now = new Date();
  const daysUntilSunset = Math.ceil(
    (deprecation.sunsetDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  );

  res.json({
    endpoint,
    deprecatedDate: deprecation.deprecatedDate,
    sunsetDate: deprecation.sunsetDate,
    daysUntilSunset: daysUntilSunset > 0 ? daysUntilSunset : 0,
    status: now > deprecation.sunsetDate ? 'sunset' : 'deprecated',
    replacementEndpoint: deprecation.replacementEndpoint,
    migrationGuide: deprecation.migrationGuide,
    reason: deprecation.reason,
  });
});

/**
 * POST /admin/deprecations
 * Register a new deprecated endpoint
 */
router.post('/deprecations', (req: Request, res: Response) => {
  try {
    const { endpoint, replacementEndpoint, migrationGuide, reason, sunsetMonths } = req.body;

    if (!endpoint) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'endpoint is required',
      });
    }

    if (deprecationManager.isDeprecated(endpoint)) {
      return res.status(409).json({
        error: 'Conflict',
        message: `Endpoint "${endpoint}" is already deprecated`,
      });
    }

    const deprecatedDate = new Date();
    const sunsetDate = new Date();
    sunsetDate.setMonth(sunsetDate.getMonth() + (sunsetMonths || 6));

    deprecationManager.registerDeprecation({
      endpoint,
      deprecatedDate,
      sunsetDate,
      replacementEndpoint,
      migrationGuide,
      reason,
    });

    res.status(201).json({
      message: 'Endpoint deprecated successfully',
      endpoint,
      sunsetDate,
      replacementEndpoint,
    });
  } catch (error) {
    res.status(400).json({
      error: 'Bad Request',
      message: (error as Error).message,
    });
  }
});

/**
 * DELETE /admin/deprecations/:endpoint
 * Remove a deprecation (after sunset date)
 */
router.delete('/deprecations/:endpoint', (req: Request, res: Response) => {
  const endpoint = req.params.endpoint;
  const deprecation = deprecationManager.getDeprecation(endpoint);

  if (!deprecation) {
    return res.status(404).json({
      error: 'Not Found',
      message: `Endpoint "${endpoint}" is not deprecated`,
    });
  }

  const now = new Date();
  if (now < deprecation.sunsetDate) {
    return res.status(400).json({
      error: 'Bad Request',
      message: `Cannot remove endpoint before sunset date (${deprecation.sunsetDate.toISOString()})`,
      daysUntilSunset: Math.ceil(
        (deprecation.sunsetDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      ),
    });
  }

  deprecationManager.removeDeprecation(endpoint);

  res.json({
    message: 'Deprecation removed successfully',
    endpoint,
  });
});

/**
 * GET /admin/deprecations/report/migration-progress
 * Get migration progress report
 */
router.get('/deprecations/report/migration-progress', (req: Request, res: Response) => {
  const status = deprecationManager.getDeprecationStatus();
  const deprecated = status.filter((s) => s.status === 'deprecated');
  const sunset = status.filter((s) => s.status === 'sunset');

  res.json({
    summary: {
      totalDeprecated: deprecated.length,
      totalSunset: sunset.length,
      totalEndpoints: status.length,
    },
    deprecated: deprecated.map((d) => ({
      endpoint: d.endpoint,
      daysUntilSunset: d.daysUntilSunset,
      replacementEndpoint: d.replacementEndpoint,
    })),
    sunset: sunset.map((s) => ({
      endpoint: s.endpoint,
      replacementEndpoint: s.replacementEndpoint,
    })),
  });
});

/**
 * GET /admin/deprecations/report/timeline
 * Get deprecation timeline
 */
router.get('/deprecations/report/timeline', (req: Request, res: Response) => {
  const status = deprecationManager.getDeprecationStatus();

  // Group by sunset date
  const timeline: Record<string, any[]> = {};

  status.forEach((item) => {
    const deprecation = deprecationManager.getDeprecation(item.endpoint);
    if (deprecation) {
      const dateKey = deprecation.sunsetDate.toISOString().split('T')[0];
      if (!timeline[dateKey]) {
        timeline[dateKey] = [];
      }
      timeline[dateKey].push({
        endpoint: item.endpoint,
        status: item.status,
        replacementEndpoint: item.replacementEndpoint,
      });
    }
  });

  res.json({
    timeline: Object.entries(timeline)
      .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
      .map(([date, endpoints]) => ({
        date,
        count: endpoints.length,
        endpoints,
      })),
  });
});

export default router;
