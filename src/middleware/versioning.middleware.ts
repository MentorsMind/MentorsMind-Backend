import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import {
  API_VERSIONS,
  CURRENT_VERSION,
  SUPPORTED_VERSIONS,
  SUNSET_WARNING_DAYS,
} from "../config/api-versions.config";
import {
  SunsetExemptionService,
  sunsetExemptionCacheKey,
} from "../services/sunset-exemption.service";
import { CacheService } from "../services/cache.service";
import { deprecatedApiCallsTotal } from "../config/metrics";
import { logger } from "../utils/logger.utils";

/**
 * Versioning Middleware
 *
 * Responsibilities:
 * 1. Attach `X-API-Version` header to every response.
 * 2. Support `Accept-Version` request header as an alternative to URL versioning.
 * 3. Attach deprecation headers (`Deprecation`, `Sunset`, `X-API-Deprecation-Date`,
 *    `X-API-Sunset-Date`) when the resolved version is deprecated.
 * 4. During the 30-day warning window before `sunsetAt`, attach a
 *    `Warning: 299 - "This API version will be sunset on {date}"` header to
 *    every response (RFC 7234).
 * 5. Enforce sunset: once `sunsetAt` has passed, return HTTP 410 Gone unless
 *    the caller holds an active sunset exemption (`X-Sunset-Exemption: active`).
 * 6. Count calls to deprecated versions via the `deprecated_api_calls_total`
 *    Prometheus counter for migration-progress monitoring.
 */

/** Shape of the 410 Gone response body returned for sunsetted versions. */
interface SunsetGoneBody {
  code: "API_VERSION_SUNSET";
  message: string;
  migrationGuide: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const SUNSET_EXEMPTION_CACHE_TTL_SECONDS = 300;

export async function versioningMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Resolve version: URL segment takes priority, then Accept-Version header, then default
  const urlVersion = extractVersionFromUrl(req.path);
  const headerVersion = normalizeVersion(
    req.headers["accept-version"] as string | undefined,
  );
  const resolvedVersion = urlVersion ?? headerVersion ?? CURRENT_VERSION;

  const versionConfig = API_VERSIONS[resolvedVersion];

  // Always set the resolved API version on the response
  res.setHeader("X-API-Version", resolvedVersion);

  // Expose supported versions on every response, including sunset responses.
  res.setHeader("X-Supported-Versions", SUPPORTED_VERSIONS.join(", "));

  // Reject requests to unknown or inactive versions with an explicit 404
  if (!versionConfig || !versionConfig.active) {
    res.status(404).json({
      success: false,
      error: `API version ${resolvedVersion} is not available`,
      supportedVersions: SUPPORTED_VERSIONS,
    });
    return;
  }

  const isDeprecated = Boolean(versionConfig.deprecatedAt);
  if (isDeprecated) {
    deprecatedApiCallsTotal.inc({ version: resolvedVersion });
  }

  // Attach deprecation headers when applicable
  if (versionConfig.deprecatedAt) {
    res.setHeader("Deprecation", versionConfig.deprecatedAt);
    res.setHeader("X-API-Deprecation-Date", versionConfig.deprecatedAt);
    if (versionConfig.sunsetAt) {
      res.setHeader("Sunset", versionConfig.sunsetAt);
      res.setHeader("X-API-Sunset-Date", versionConfig.sunsetAt);
    }
    if (versionConfig.deprecationMessage) {
      res.setHeader("X-Deprecation-Message", versionConfig.deprecationMessage);
    }
    if (versionConfig.migrationGuide) {
      res.setHeader(
        "Link",
        `<${versionConfig.migrationGuide}>; rel="successor-version"`,
      );
    }
  }

  const daysUntilSunset = versionConfig.sunsetAt
    ? Math.ceil((new Date(versionConfig.sunsetAt).getTime() - Date.now()) / DAY_MS)
    : null;

  // ─── Sunset enforcement ────────────────────────────────────────────────────
  // Once sunsetAt has passed the version is gone — respond 410 immediately,
  // unless the caller holds an active exemption.
  if (daysUntilSunset !== null && daysUntilSunset <= 0) {
    await handleSunset(req, res, resolvedVersion, versionConfig, next);
    return;
  }

  // ─── Warning window: 30 days before sunsetAt ───────────────────────────────
  if (
    daysUntilSunset !== null &&
    daysUntilSunset > 0 &&
    daysUntilSunset <= SUNSET_WARNING_DAYS
  ) {
    res.setHeader(
      "Warning",
      `299 - "This API version will be sunset on ${versionConfig.sunsetAt}"`,
    );
  }

  next();
}

/**
 * Resolve the caller's userId for exemption checks.
 *
 * The versioning middleware runs before route-level auth, so `req.user` is
 * usually unset here. When a Bearer token is present we verify it with the
 * API JWT secret purely to identify the caller — access control for the
 * actual resource still happens in the normal auth middleware downstream.
 */
function extractCallerUserId(req: Request): string | undefined {
  if (req.user?.id) return req.user.id;

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return undefined;

  try {
    const payload = jwt.verify(
      authHeader.slice("Bearer ".length),
      process.env.JWT_SECRET ?? "",
    ) as { id?: string; userId?: string; sub?: string } | undefined;
    return payload?.id ?? payload?.userId ?? payload?.sub;
  } catch {
    // Invalid/expired token — no exemption identity available.
    return undefined;
  }
}

async function handleSunset(
  req: Request,
  res: Response,
  version: string,
  versionConfig: (typeof API_VERSIONS)[string],
  next: NextFunction,
): Promise<void> {
  let exempt = false;
  try {
    const userId = extractCallerUserId(req);
    if (!userId) {
      exempt = await SunsetExemptionService.isExempt(userId, version);
    } else {
      const key = sunsetExemptionCacheKey(userId, version);
      const cached = await CacheService.get<boolean>(key);
      if (cached !== null) {
        exempt = cached;
      } else {
        exempt = await SunsetExemptionService.isExempt(userId, version);
        await CacheService.set(key, exempt, SUNSET_EXEMPTION_CACHE_TTL_SECONDS);
      }
    }
  } catch (error) {
    logger.warn("Sunset exemption check failed", {
      version,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (exempt) {
    res.setHeader("X-Sunset-Exemption", "active");
    next();
    return;
  }

  const successor = versionConfig.successorVersion ?? CURRENT_VERSION;
  const body: SunsetGoneBody = {
    code: "API_VERSION_SUNSET",
    message: `This API version was sunset on ${versionConfig.sunsetAt}. Please migrate to ${successor}.`,
    migrationGuide:
      versionConfig.migrationGuide ??
      `https://docs.mentorminds.com/api/migration/${version}-to-${successor}`,
  };

  logger.info("Sunsetted API version blocked", {
    version,
    path: req.path,
    clientIp: req.ip,
    userAgent: req.get("user-agent"),
  });

  res.status(410).json(body);
}

/** Extract "v1", "v2", etc. from a URL path like /api/v1/users */
function extractVersionFromUrl(urlPath: string): string | undefined {
  const match = urlPath.match(/^\/api\/(v\d+)/);
  return match ? match[1] : undefined;
}

/** Normalise an Accept-Version value: strips leading "v" if missing, lowercases */
function normalizeVersion(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim().toLowerCase();
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}
