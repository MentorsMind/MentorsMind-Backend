/**
 * API Sunset Enforcement Middleware
 *
 * Hard enforcement of API version sunset dates. After sunsetAt passes,
 * requests to sunset API versions are rejected with 410 Gone.
 *
 * This prevents indefinite support of deprecated API versions and
 * ensures migration pressure on API consumers.
 */

import { Request, Response, NextFunction } from "express";
import { API_VERSIONS } from "../config/api-versions.config";
import { logger } from "../utils/logger.utils";
import { AppError } from "../types/error.types";
import { SERVICE_CODES } from "../constants/error-codes";

/**
 * Extract API version from URL path or Accept-Version header
 */
function extractApiVersion(req: Request): string | null {
  // Check URL path first: /api/v1/... -> "v1"
  const urlMatch = req.path.match(/^\/api\/(v\d+)/);
  if (urlMatch) {
    return urlMatch[1];
  }

  // Fall back to Accept-Version header
  const acceptVersion = req.headers["accept-version"];
  if (acceptVersion && typeof acceptVersion === "string") {
    const normalized = acceptVersion.trim().toLowerCase();
    return normalized.startsWith("v") ? normalized : `v${normalized}`;
  }

  return null;
}

/**
 * Parse ISO 8601 date string and compare with current time
 */
function isSunsetDatePassed(sunsetAtIso: string): boolean {
  try {
    const sunsetDate = new Date(sunsetAtIso);
    if (isNaN(sunsetDate.getTime())) {
      logger.error("Invalid sunsetAt date format", {
        sunsetAtIso,
        error: "Date parse failed",
      });
      return false;
    }
    return new Date() > sunsetDate;
  } catch (err) {
    logger.error("Error parsing sunsetAt date", {
      sunsetAtIso,
      error: String(err),
    });
    return false;
  }
}

/**
 * Calculate days until sunset
 */
function getDaysUntilSunset(sunsetAtIso: string): number {
  try {
    const sunsetDate = new Date(sunsetAtIso);
    const now = new Date();
    const diffMs = sunsetDate.getTime() - now.getTime();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  } catch {
    return -1;
  }
}

/**
 * Middleware to enforce API version sunsets
 *
 * - Returns 410 Gone if API version has sunset
 * - Returns 401 Unauthorized with specific warning if within grace period
 * - Logs sunset violations for monitoring
 *
 * Usage:
 *   app.use("/api", apiSunsetEnforcementMiddleware);
 */
export function apiSunsetEnforcementMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const apiVersion = extractApiVersion(req);

  // Skip enforcement for non-API routes
  if (!apiVersion) {
    return next();
  }

  const versionConfig = API_VERSIONS[apiVersion];

  // Unknown version - let router handle 404
  if (!versionConfig) {
    return next();
  }

  // Version not active (deprecated and inactive)
  if (!versionConfig.active) {
    logger.warn(`Inactive API version requested: ${apiVersion}`, {
      requestPath: req.path,
      method: req.method,
      clientIp: req.ip,
      userAgent: req.get("user-agent"),
    });

    return res.status(404).json({
      status: "error",
      code: "SERVER_NOT_FOUND",
      message: `API version ${apiVersion} is no longer available`,
      details: {
        requestedVersion: apiVersion,
        reason: "This API version has been deactivated",
        migrationGuide: versionConfig.deprecationMessage,
      },
      requestId: (req as any).requestId,
      timestamp: new Date().toISOString(),
    });
  }

  // Check if version has sunset date in past
  if (versionConfig.sunsetAt && isSunsetDatePassed(versionConfig.sunsetAt)) {
    const daysOverdue = Math.abs(
      getDaysUntilSunset(versionConfig.sunsetAt)
    );

    logger.error(`Sunset API version accessed: ${apiVersion}`, {
      requestPath: req.path,
      method: req.method,
      sunsetAt: versionConfig.sunsetAt,
      daysOverdue,
      clientIp: req.ip,
      userAgent: req.get("user-agent"),
    });

    // Hard block: Return 410 Gone
    return res.status(410).json({
      status: "error",
      code: "SERVER_NOT_FOUND",
      message: `API version ${apiVersion} has been permanently removed`,
      details: {
        requestedVersion: apiVersion,
        sunsetDate: versionConfig.sunsetAt,
        daysOverdue,
        reason: versionConfig.deprecationMessage
          ? `${versionConfig.deprecationMessage}. This version was sunset on ${versionConfig.sunsetAt}`
          : `This API version was sunset on ${versionConfig.sunsetAt} and is no longer available`,
        action:
          "Please migrate to a newer API version immediately. Continued use of sunset APIs violates SLA terms.",
      },
      requestId: (req as any).requestId,
      timestamp: new Date().toISOString(),
    });
  }

  // Check if version is deprecated and within final grace period
  if (
    versionConfig.deprecatedAt &&
    versionConfig.sunsetAt &&
    !isSunsetDatePassed(versionConfig.sunsetAt)
  ) {
    const daysUntilSunset = getDaysUntilSunset(versionConfig.sunsetAt);

    // GRACE PERIOD 1: 0-7 days until sunset -> return 400 Bad Request with urgent warning
    if (daysUntilSunset >= 0 && daysUntilSunset <= 7) {
      logger.warn(`Critical: Deprecated API version with <7 days: ${apiVersion}`, {
        requestPath: req.path,
        daysUntilSunset,
        sunsetAt: versionConfig.sunsetAt,
        clientIp: req.ip,
      });

      res.setHeader("X-API-Sunset-Critical", "true");
      res.setHeader("X-Deprecation", "true");
      res.setHeader("Sunset", new Date(versionConfig.sunsetAt).toUTCString());
      res.setHeader(
        "Retry-After",
        "0"
      ); // Don't retry, client must upgrade immediately

      // Return 400 to signal that client code must change
      return res.status(400).json({
        status: "error",
        code: "VALIDATION_INVALID_INPUT",
        message: `API version ${apiVersion} is being removed in ${daysUntilSunset} day(s)`,
        details: {
          requestedVersion: apiVersion,
          sunsetDate: versionConfig.sunsetAt,
          daysUntilSunset,
          reason: "This API version will be permanently removed",
          action: "URGENT: Upgrade to a newer API version immediately",
          migrationGuide: versionConfig.deprecationMessage,
        },
        requestId: (req as any).requestId,
        timestamp: new Date().toISOString(),
      });
    }

    // GRACE PERIOD 2: 7-30 days until sunset -> add headers but allow requests
    if (daysUntilSunset > 7 && daysUntilSunset <= 30) {
      logger.warn(
        `Deprecated API version with <30 days to sunset: ${apiVersion}`,
        {
          requestPath: req.path,
          daysUntilSunset,
          sunsetAt: versionConfig.sunsetAt,
          clientIp: req.ip,
        }
      );

      res.setHeader("X-API-Sunset-Warning", "true");
      res.setHeader("X-Deprecation", "true");
      res.setHeader("Deprecation", versionConfig.deprecatedAt);
      res.setHeader("Sunset", new Date(versionConfig.sunsetAt).toUTCString());
      res.setHeader(
        "X-Deprecation-Message",
        `${versionConfig.deprecationMessage}. This version will be removed in ${daysUntilSunset} days`
      );
    }

    // GRACE PERIOD 3: 30+ days until sunset -> add headers only
    if (daysUntilSunset > 30) {
      res.setHeader("X-Deprecation", "true");
      res.setHeader("Deprecation", versionConfig.deprecatedAt);
      res.setHeader("Sunset", new Date(versionConfig.sunsetAt).toUTCString());
      if (versionConfig.deprecationMessage) {
        res.setHeader("X-Deprecation-Message", versionConfig.deprecationMessage);
      }
    }
  }

  next();
}

/**
 * Helper to check if a version is in critical sunset period
 * (returns 410 or 400 to clients)
 *
 * Useful for client libraries to detect when they MUST upgrade
 */
export function isCriticalSunsetPeriod(version: string): boolean {
  const versionConfig = API_VERSIONS[version];
  if (!versionConfig || !versionConfig.sunsetAt) {
    return false;
  }

  // Either already sunset OR within final 7 days
  const daysUntilSunset = getDaysUntilSunset(versionConfig.sunsetAt);
  return daysUntilSunset <= 7;
}

/**
 * Helper to check if a version is sunset
 */
export function isSunset(version: string): boolean {
  const versionConfig = API_VERSIONS[version];
  if (!versionConfig || !versionConfig.sunsetAt) {
    return false;
  }

  return isSunsetDatePassed(versionConfig.sunsetAt);
}

/**
 * Get all versions that are in critical sunset period
 * (should be used for monitoring/alerting)
 */
export function getCriticalSunsetVersions(): Array<{
  version: string;
  sunsetAt: string;
  daysUntilSunset: number;
  status: "critical-7days" | "sunset";
}> {
  return Object.entries(API_VERSIONS)
    .filter(
      ([, config]) =>
        config.sunsetAt && (isSunsetDatePassed(config.sunsetAt) || getDaysUntilSunset(config.sunsetAt) <= 7)
    )
    .map(([version, config]) => ({
      version,
      sunsetAt: config.sunsetAt!,
      daysUntilSunset: getDaysUntilSunset(config.sunsetAt!),
      status: isSunsetDatePassed(config.sunsetAt!)
        ? "sunset"
        : "critical-7days",
    }));
}

/**
 * Get all versions with their sunset status
 */
export function getVersionSunsetStatus(): Array<{
  version: string;
  active: boolean;
  deprecatedAt?: string;
  sunsetAt?: string;
  daysUntilSunset?: number;
  status: "active" | "deprecated" | "critical-warning" | "sunset";
}> {
  return Object.entries(API_VERSIONS).map(([version, config]) => {
    if (!config.sunsetAt) {
      return {
        version,
        active: config.active,
        deprecatedAt: config.deprecatedAt,
        status: "active",
      };
    }

    const daysUntilSunset = getDaysUntilSunset(config.sunsetAt);
    const isSunsetPassed = isSunsetDatePassed(config.sunsetAt);

    let status: "active" | "deprecated" | "critical-warning" | "sunset" =
      "active";
    if (isSunsetPassed) {
      status = "sunset";
    } else if (daysUntilSunset <= 7) {
      status = "critical-warning";
    } else if (config.deprecatedAt) {
      status = "deprecated";
    }

    return {
      version,
      active: config.active,
      deprecatedAt: config.deprecatedAt,
      sunsetAt: config.sunsetAt,
      daysUntilSunset: isSunsetPassed ? undefined : daysUntilSunset,
      status,
    };
  });
}
