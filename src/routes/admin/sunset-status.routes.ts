/**
 * Admin API Sunset Status Routes
 *
 * Endpoints for monitoring API version sunsets, compliance, and enforcement.
 * Restricted to admin users only.
 *
 * Endpoints:
 * - GET /admin/api/sunsets/status - Current sunset status of all versions
 * - GET /admin/api/sunsets/critical - Critical versions needing action
 * - GET /admin/api/sunsets/compliance - Compliance report
 * - GET /admin/api/sunsets/timeline - Sunset timeline
 */

import { Router, Request, Response, NextFunction } from "express";
import { requireAdmin } from "../../middleware/auth.middleware";
import {
  getVersionSunsetStatus,
  getCriticalSunsetVersions,
  isSunset,
  isCriticalSunsetPeriod,
} from "../../middleware/api-sunset-enforcement.middleware";
import { API_VERSIONS } from "../../config/api-versions.config";

const router = Router();

/**
 * Apply admin authentication to all routes
 */
router.use(requireAdmin);

/**
 * GET /admin/api/sunsets/status
 *
 * Returns complete sunset status of all API versions
 *
 * Response:
 * {
 *   versions: [
 *     {
 *       version: "v1",
 *       active: true,
 *       deprecatedAt: "2026-06-01T00:00:00Z",
 *       sunsetAt: "2026-09-01T00:00:00Z",
 *       daysUntilSunset: 25,
 *       status: "deprecated" | "critical-warning" | "sunset"
 *     }
 *   ]
 * }
 */
router.get("/status", (req: Request, res: Response): void => {
  const versions = getVersionSunsetStatus();

  res.status(200).json({
    status: "success",
    data: {
      timestamp: new Date().toISOString(),
      versions,
      summary: {
        total: versions.length,
        active: versions.filter((v) => v.status === "active").length,
        deprecated: versions.filter((v) => v.status === "deprecated").length,
        criticalWarning: versions.filter((v) => v.status === "critical-warning")
          .length,
        sunset: versions.filter((v) => v.status === "sunset").length,
      },
    },
  });
});

/**
 * GET /admin/api/sunsets/critical
 *
 * Returns only versions in critical periods (<7 days or already sunset)
 * Useful for alerting
 *
 * Response:
 * {
 *   critical: [
 *     {
 *       version: "v1",
 *       sunsetAt: "2026-09-01T00:00:00Z",
 *       daysUntilSunset: 3,
 *       status: "critical-7days" | "sunset"
 *     }
 *   ]
 * }
 */
router.get("/critical", (req: Request, res: Response): void => {
  const critical = getCriticalSunsetVersions();

  res.status(200).json({
    status: "success",
    data: {
      timestamp: new Date().toISOString(),
      critical,
      needsAction: critical.length > 0,
      actionRequired:
        critical.length > 0
          ? `${critical.length} API version(s) require immediate attention`
          : "No critical sunset periods detected",
    },
  });
});

/**
 * GET /admin/api/sunsets/compliance
 *
 * Returns compliance information about sunset enforcement
 * (which versions are enforcing hard blocks, etc.)
 */
router.get("/compliance", (req: Request, res: Response): void => {
  const versions = getVersionSunsetStatus();

  const compliance = {
    enforcement: {
      hardBlockOnSunset: true,
      warningPeriod: "30 days before sunset",
      criticalPeriod: "7 days before sunset",
      criticalBehavior: "Returns 400 Bad Request",
      sunsetBehavior: "Returns 410 Gone",
    },
    versions: versions.map((v) => ({
      version: v.version,
      active: v.active,
      isEnforced:
        v.status === "critical-warning" || v.status === "sunset"
          ? true
          : false,
      status: v.status,
      enforcementLevel:
        v.status === "sunset"
          ? "HARD_BLOCK_410"
          : v.status === "critical-warning"
            ? "HARD_BLOCK_400"
            : "WARN_HEADERS",
      daysUntilEnforcement:
        v.daysUntilSunset && v.daysUntilSunset <= 7
          ? v.daysUntilSunset
          : null,
    })),
  };

  res.status(200).json({
    status: "success",
    data: compliance,
  });
});

/**
 * GET /admin/api/sunsets/timeline
 *
 * Returns a timeline of sunset dates for planning
 */
router.get("/timeline", (req: Request, res: Response): void => {
  const versions = Object.entries(API_VERSIONS)
    .filter(([, config]) => config.sunsetAt)
    .sort(
      ([, a], [, b]) =>
        new Date(a.sunsetAt!).getTime() - new Date(b.sunsetAt!).getTime()
    )
    .map(([version, config]) => ({
      version,
      deprecatedAt: config.deprecatedAt,
      sunsetAt: config.sunsetAt,
      daysUntilSunset:
        (new Date(config.sunsetAt!).getTime() - new Date().getTime()) /
        (1000 * 60 * 60 * 24),
      status: isSunset(version)
        ? "SUNSET"
        : isCriticalSunsetPeriod(version)
          ? "CRITICAL"
          : "UPCOMING",
    }));

  // Group by time periods
  const now = new Date();
  const timeline = {
    already_sunset: versions.filter((v) => v.status === "SUNSET"),
    critical_0_7_days: versions.filter(
      (v) => v.status === "CRITICAL" && v.daysUntilSunset > 0
    ),
    warning_7_30_days: versions.filter(
      (v) => v.daysUntilSunset > 7 && v.daysUntilSunset <= 30
    ),
    upcoming_30_90_days: versions.filter(
      (v) => v.daysUntilSunset > 30 && v.daysUntilSunset <= 90
    ),
    future_90_plus_days: versions.filter((v) => v.daysUntilSunset > 90),
  };

  res.status(200).json({
    status: "success",
    data: {
      timestamp: new Date().toISOString(),
      now: now.toISOString(),
      timeline,
      actions:
        timeline.already_sunset.length > 0 ||
        timeline.critical_0_7_days.length > 0
          ? [
              {
                priority: "URGENT",
                description: "Versions require immediate action",
                versions:
                  timeline.already_sunset.length > 0
                    ? timeline.already_sunset.map((v) => v.version)
                    : timeline.critical_0_7_days.map((v) => v.version),
              },
            ]
          : timeline.warning_7_30_days.length > 0
            ? [
                {
                  priority: "HIGH",
                  description: "Prepare for sunset in <30 days",
                  versions: timeline.warning_7_30_days.map((v) => v.version),
                },
              ]
            : [],
    },
  });
});

/**
 * GET /admin/api/sunsets/check-version/:version
 *
 * Check sunset status of a specific version
 */
router.get("/check-version/:version", (req: Request, res: Response): void => {
  const { version } = req.params;
  const config = API_VERSIONS[version];

  if (!config) {
    return res.status(404).json({
      status: "error",
      message: `Version ${version} not found`,
      supportedVersions: Object.keys(API_VERSIONS),
    });
  }

  const status = getVersionSunsetStatus().find((v) => v.version === version);

  res.status(200).json({
    status: "success",
    data: {
      version,
      config,
      sunsetStatus: status,
      isSunset: isSunset(version),
      isInCriticalPeriod: isCriticalSunsetPeriod(version),
    },
  });
});

/**
 * POST /admin/api/sunsets/acknowledge-critical/:version
 *
 * Acknowledge that team is aware of critical sunset period
 * Logs acknowledgment for audit trail
 */
router.post(
  "/acknowledge-critical/:version",
  (req: Request, res: Response): void => {
    const { version } = req.params;
    const { reason, plannedAction } = req.body;

    const status = getVersionSunsetStatus().find((v) => v.version === version);

    if (!status) {
      return res.status(404).json({
        status: "error",
        message: `Version ${version} not found`,
      });
    }

    if (status.status !== "critical-warning") {
      return res.status(400).json({
        status: "error",
        message: `${version} is not in critical warning period (current status: ${status.status})`,
      });
    }

    // In production, this would log to audit system
    console.log("Sunset acknowledgment", {
      version,
      status: status.status,
      sunsetAt: status.sunsetAt,
      daysUntilSunset: status.daysUntilSunset,
      acknowledgedBy: (req as any).user?.id,
      acknowledgedAt: new Date().toISOString(),
      reason,
      plannedAction,
    });

    res.status(200).json({
      status: "success",
      message: `Acknowledged critical sunset period for ${version}`,
      data: {
        version,
        daysUntilSunset: status.daysUntilSunset,
        sunsetAt: status.sunsetAt,
        acknowledgment: {
          acknowledgedBy: (req as any).user?.email,
          acknowledgedAt: new Date().toISOString(),
          reason,
          plannedAction,
        },
      },
    });
  }
);

export default router;
