/**
 * API Sunset Enforcement Middleware
 * 
 * Prevents requests to API versions that have passed their sunsetAt date.
 * This is the hard enforcement layer that ensures sunset dates are respected.
 * 
 * After sunsetAt passes, clients receive 410 Gone instead of continuing to work.
 * This creates immediate migration pressure (not optional).
 */

import { Request, Response, NextFunction } from 'express';
import { API_VERSIONS } from '../config/api-versions.config';
import { logger } from '../utils/logger.utils';
import { AppError, ErrorCode } from '../utils/app-error';

/**
 * Check if a version is currently sunset (past sunsetAt date)
 */
export function isVersionSunset(version: string): boolean {
  const versionConfig = API_VERSIONS[version];
  if (!versionConfig || !versionConfig.sunsetAt) {
    return false;
  }

  const sunsetDate = new Date(versionConfig.sunsetAt);
  return new Date() > sunsetDate;
}

/**
 * Get days until sunset for a version (negative if already sunset)
 */
export function getDaysUntilSunset(version: string): number | null {
  const versionConfig = API_VERSIONS[version];
  if (!versionConfig || !versionConfig.sunsetAt) {
    return null;
  }

  const sunsetDate = new Date(versionConfig.sunsetAt);
  const now = new Date();
  return Math.ceil((sunsetDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Middleware: Enforce API version sunset dates
 * 
 * Blocks requests to sunset versions with 410 Gone response.
 * This is mandatory enforcement - not optional headers.
 * 
 * Usage:
 * app.use('/api/v1', sunsetEnforcementMiddleware);
 * app.use('/api/v2', sunsetEnforcementMiddleware);
 */
export function sunsetEnforcementMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Extract version from path: /api/v1 → v1
  const pathMatch = req.path.match(/^\/api\/v(\d+)/);
  if (!pathMatch) {
    next();
    return;
  }

  const version = `v${pathMatch[1]}`;

  // Check if this version is sunset
  if (isVersionSunset(version)) {
    const versionConfig = API_VERSIONS[version];
    const sunsetDate = new Date(versionConfig.sunsetAt!);

    const endpoint = `${req.method} ${req.path}`;
    const clientIp = req.ip || 'unknown';
    const userAgent = req.get('user-agent') || 'unknown';

    logger.error(`Sunset version accessed (410 Gone)`, {
      version,
      endpoint,
      sunsetDate: sunsetDate.toISOString(),
      clientIp,
      userAgent,
      userId: (req as any).user?.userId,
    });

    // Return 410 Gone - endpoint is no longer available
    return res.status(410).json({
      status: 'error',
      code: ErrorCode.SERVICE_UNAVAILABLE,
      message: `API version ${version} is no longer supported`,
      category: 'SERVICE_UNAVAILABLE',
      requestId: (req as any).requestId,
      timestamp: new Date().toISOString(),
      details: {
        context: {
          version,
          sunsetDate: sunsetDate.toISOString(),
          replacementVersion: findReplacementVersion(version),
          migrationGuide: `https://docs.mentorminds.com/migration/${version}-to-${findReplacementVersion(version) || 'latest'}`,
        },
        retryable: false,
      },
    });
  }

  // Check if sunset is approaching (30 days or less)
  const daysUntilSunset = getDaysUntilSunset(version);
  if (daysUntilSunset !== null && daysUntilSunset > 0 && daysUntilSunset <= 30) {
    logger.warn(`Endpoint sunset approaching`, {
      version,
      endpoint: `${req.method} ${req.path}`,
      daysUntilSunset,
      sunsetDate: new Date(API_VERSIONS[version].sunsetAt!).toISOString(),
    });

    // Add warning headers
    res.set('Sunset', new Date(API_VERSIONS[version].sunsetAt!).toUTCString());
    res.set('Deprecation', 'true');
    res.set(
      'Warning',
      `299 - "API version ${version} will be removed in ${daysUntilSunset} days"`
    );
  }

  next();
}

/**
 * Middleware: Strict deprecation enforcement
 * 
 * Returns 410 Gone if version is deprecated AND within final enforcement window (7 days or less).
 * Use this for versions in their last week before sunset.
 */
export function strictSunsetEnforcementMiddleware(req: Request, res: Response, next: NextFunction): void {
  const pathMatch = req.path.match(/^\/api\/v(\d+)/);
  if (!pathMatch) {
    next();
    return;
  }

  const version = `v${pathMatch[1]}`;
  const versionConfig = API_VERSIONS[version];

  if (!versionConfig.sunsetAt) {
    next();
    return;
  }

  const daysUntilSunset = getDaysUntilSunset(version);
  
  // Block with 410 if sunset is within 7 days
  if (daysUntilSunset !== null && daysUntilSunset <= 7 && daysUntilSunset >= 0) {
    const sunsetDate = new Date(versionConfig.sunsetAt);

    logger.error(`Strict sunset enforcement: request blocked (410 Gone)`, {
      version,
      endpoint: `${req.method} ${req.path}`,
      daysUntilSunset,
      sunsetDate: sunsetDate.toISOString(),
    });

    return res.status(410).json({
      status: 'error',
      code: ErrorCode.SERVICE_UNAVAILABLE,
      message: `API version ${version} will be removed on ${sunsetDate.toISOString()} - MIGRATE IMMEDIATELY`,
      category: 'SERVICE_UNAVAILABLE',
      requestId: (req as any).requestId,
      timestamp: new Date().toISOString(),
      details: {
        context: {
          version,
          sunsetDate: sunsetDate.toISOString(),
          daysUntilRemoval: daysUntilSunset,
          replacementVersion: findReplacementVersion(version),
          migrationGuide: `https://docs.mentorminds.com/migration/${version}-to-${findReplacementVersion(version) || 'latest'}`,
        },
        retryable: false,
      },
    });
  }

  next();
}

/**
 * Find the replacement version for a given version
 * Used to suggest migration path
 */
function findReplacementVersion(version: string): string | null {
  const versions = Object.keys(API_VERSIONS).sort().reverse();
  const currentIndex = versions.indexOf(version);

  if (currentIndex === -1 || currentIndex === 0) {
    // No newer version found, suggest latest active version
    const latestActive = versions.find(v => API_VERSIONS[v].active);
    return latestActive || null;
  }

  return versions[currentIndex - 1] || null;
}

/**
 * Get all sunset versions with metadata
 */
export function getSunsetVersions(): Array<{
  version: string;
  sunsetDate: string;
  daysUntilSunset: number;
  isAlreadySunset: boolean;
  replacementVersion: string | null;
}> {
  return Object.entries(API_VERSIONS)
    .filter(([_, config]) => config.sunsetAt)
    .map(([version, config]) => ({
      version,
      sunsetDate: config.sunsetAt!,
      daysUntilSunset: getDaysUntilSunset(version) || 0,
      isAlreadySunset: isVersionSunset(version),
      replacementVersion: findReplacementVersion(version),
    }))
    .sort((a, b) => new Date(a.sunsetDate).getTime() - new Date(b.sunsetDate).getTime());
}

/**
 * Check deployment readiness: ensure no deprecated versions are still receiving traffic
 * This should be called before deployment to warn about enforcement
 */
export function checkSunsetEnforcementReadiness(): {
  ready: boolean;
  issues: string[];
  warnings: string[];
} {
  const issues: string[] = [];
  const warnings: string[] = [];

  const sunsetVersions = getSunsetVersions();

  for (const v of sunsetVersions) {
    if (v.isAlreadySunset) {
      issues.push(
        `Version ${v.version} is past sunset date (${v.sunsetDate}) and should no longer be served`
      );
    } else if (v.daysUntilSunset <= 7 && v.daysUntilSunset > 0) {
      warnings.push(
        `Version ${v.version} will sunset in ${v.daysUntilSunset} days (${v.sunsetDate})`
      );
    }
  }

  return {
    ready: issues.length === 0,
    issues,
    warnings,
  };
}
