/**
 * Region-Aware Routing Middleware
 *
 * Express middleware that:
 * - Determines optimal region for each request
 * - Handles failover and circuit breaking
 * - Maintains session affinity
 * - Provides region information in request context
 */

import { Request, Response, NextFunction } from "express";
import { getRegionRoutingService } from "../services/region-routing.service";
import regionConfig from "../config/region.config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

declare global {
  namespace Express {
    interface Request {
      region?: {
        id: string;
        endpoint: string;
        isDegraded: boolean;
        reason: string;
      };
      userLocation?: {
        latitude: number;
        longitude: number;
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Middleware Factory
// ---------------------------------------------------------------------------

/**
 * Creates region-aware routing middleware
 */
export function createRegionMiddleware() {
  const routingService = getRegionRoutingService();

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Skip if multi-region is disabled
      if (!regionConfig.enabled) {
        return next();
      }

      // Extract user location from headers or IP geolocation
      const userLocation = extractUserLocation(req);

      // Extract session ID
      const sessionId = extractSessionId(req);

      // Determine optimal region
      const routing = await routingService.getOptimalRegion({
        userId: req.user?.id,
        userLatitude: userLocation?.latitude,
        userLongitude: userLocation?.longitude,
        sessionId,
      });

      // Attach region info to request
      req.region = {
        id: routing.regionId,
        endpoint: routing.endpoint,
        isDegraded: routing.isDegraded,
        reason: routing.reason,
      };

      req.userLocation = userLocation;

      // Set region headers for downstream services
      res.setHeader("X-Region-Id", routing.regionId);
      res.setHeader("X-Region-Degraded", routing.isDegraded.toString());

      // Log region routing decision (for debugging)
      if (process.env.NODE_ENV !== "production") {
        console.log(`[Region] ${routing.regionId} - ${routing.reason}`);
      }

      next();
    } catch (error) {
      console.error("Region routing error:", error);
      next();
    }
  };
}

/**
 * Extract user location from request headers or IP
 */
function extractUserLocation(req: Request) {
  // Check for explicit location headers
  const latitude = req.headers["x-user-latitude"];
  const longitude = req.headers["x-user-longitude"];

  if (latitude && longitude) {
    return {
      latitude: parseFloat(latitude as string),
      longitude: parseFloat(longitude as string),
    };
  }

  // Try CloudFlare GeoIP headers
  const cfLatitude = req.headers["cf-iplatitude"];
  const cfLongitude = req.headers["cf-iplongitude"];

  if (cfLatitude && cfLongitude) {
    return {
      latitude: parseFloat(cfLatitude as string),
      longitude: parseFloat(cfLongitude as string),
    };
  }

  // Try AWS CloudFront GeoIP headers
  const cfCountry = req.headers["cloudfront-viewer-country"];
  if (cfCountry) {
    // Map country code to approximate center coordinates
    const coordinates = getCountryCoordinates(cfCountry as string);
    if (coordinates) return coordinates;
  }

  return undefined;
}

/**
 * Extract session ID from request
 */
function extractSessionId(req: Request): string | undefined {
  // Check cookies
  const cookies = req.headers.cookie;
  if (cookies) {
    const sessionMatch = cookies.match(/sessionId=([^;]+)/);
    if (sessionMatch) return sessionMatch[1];
  }

  // Check Authorization header for JWT (extract user ID as pseudo-session)
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    try {
      const token = authHeader.substring(7);
      // Simple JWT parsing (without verification - middleware doesn't have secret)
      const payload = Buffer.from(token.split(".")[1], "base64").toString();
      const decoded = JSON.parse(payload);
      return decoded.sub || decoded.userId;
    } catch {
      // Ignore JWT parse errors
    }
  }

  return undefined;
}

/**
 * Approximate country center coordinates for GeoIP routing
 */
function getCountryCoordinates(countryCode: string): {
  latitude: number;
  longitude: number;
} | null {
  const countryCoordinates: Record<
    string,
    { latitude: number; longitude: number }
  > = {
    US: { latitude: 37.0902, longitude: -95.7129 },
    GB: { latitude: 55.3781, longitude: -3.436 },
    FR: { latitude: 46.2276, longitude: 2.2137 },
    DE: { latitude: 51.1657, longitude: 10.4515 },
    NL: { latitude: 52.1326, longitude: 5.2913 },
    IE: { latitude: 53.4129, longitude: -8.2439 },
    AU: { latitude: -25.2744, longitude: 133.7751 },
    SG: { latitude: 1.3521, longitude: 103.8198 },
    JP: { latitude: 36.2048, longitude: 138.2529 },
    IN: { latitude: 20.5937, longitude: 78.9629 },
    BR: { latitude: -14.2350, longitude: -51.9253 },
    CA: { latitude: 56.1304, longitude: -106.3468 },
    MX: { latitude: 23.6345, longitude: -102.5528 },
  };

  return countryCoordinates[countryCode] || null;
}

// ---------------------------------------------------------------------------
// Failover Middleware
// ---------------------------------------------------------------------------

/**
 * Middleware to handle region failover for failed requests
 */
export function createFailoverMiddleware() {
  const routingService = getRegionRoutingService();

  return (err: any, req: Request, res: Response, next: NextFunction) => {
    // Only handle region-specific errors
    if (!err.regionId || !regionConfig.failover.automaticFailover) {
      return next(err);
    }

    const primaryRegion = err.regionId;
    const failoverRoutes = routingService.getFailoverRoutes(primaryRegion);

    if (failoverRoutes.length === 0) {
      return next(err);
    }

    // Try first healthy failover route
    const healthyRoute = failoverRoutes.find((r) => r.isHealthy);
    if (healthyRoute) {
      res.setHeader("X-Failover-Region", healthyRoute.regionId);
      res.setHeader("X-Original-Region", primaryRegion);

      // In production, would proxy the request to failover region
      // For now, just mark as failed and let app handle gracefully
      console.warn(
        `Failover from ${primaryRegion} to ${healthyRoute.regionId}`
      );
    }

    next(err);
  };
}

// ---------------------------------------------------------------------------
// Health Check Endpoint Middleware
// ---------------------------------------------------------------------------

/**
 * Middleware to handle region-specific health checks
 */
export function createRegionHealthMiddleware() {
  const routingService = getRegionRoutingService();

  return (req: Request, res: Response, next: NextFunction) => {
    // Health check endpoint
    if (req.path === "/health/regions" || req.path === "/admin/health/regions") {
      const status = routingService.getRegionStatus();
      return res.json({
        regions: status.map((s) => ({
          regionId: s.regionId,
          healthy: s.healthy,
          latency: s.latency,
          responseTime: s.responseTime,
          lastCheckTime: new Date(s.lastCheckTime),
          consecutiveFailures: s.consecutiveFailures,
          consecutiveSuccesses: s.consecutiveSuccesses,
        })),
        primaryRegion: regionConfig.primaryRegion,
        activeRegions: regionConfig.activeRegions,
      });
    }

    next();
  };
}

// ---------------------------------------------------------------------------
// Region-Specific Request Header Middleware
// ---------------------------------------------------------------------------

/**
 * Middleware to add region-specific headers and context
 */
export function createRegionContextMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!regionConfig.enabled || !req.region) {
      return next();
    }

    // Add headers for region context
    res.setHeader("X-Served-By-Region", req.region.id);

    // Add to locals for view rendering
    if (res.locals) {
      res.locals.region = req.region;
    }

    // Set region-specific database connection context
    if (req.regionContext) {
      req.regionContext = {
        regionId: req.region.id,
        endpoint: req.region.endpoint,
        isDegraded: req.region.isDegraded,
      };
    }

    next();
  };
}

// ---------------------------------------------------------------------------
// Region Override Middleware (for testing/admin)
// ---------------------------------------------------------------------------

/**
 * Middleware to allow region override via query parameter or header
 * CAUTION: Should only be enabled in development/staging
 */
export function createRegionOverrideMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    // Only allow in non-production
    if (process.env.NODE_ENV === "production") {
      return next();
    }

    const override =
      req.query.regionOverride ||
      req.headers["x-region-override"] ||
      (req.user && req.user.isDev ? req.body?.regionOverride : undefined);

    if (override && typeof override === "string") {
      regionConfig.failover.overrideRegion = override;
      res.setHeader("X-Region-Override", override);
    }

    next();
  };
}

export {
  extractUserLocation,
  extractSessionId,
  getCountryCoordinates,
};
