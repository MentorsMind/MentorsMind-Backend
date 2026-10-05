/**
 * Smart CDN Cache Headers Middleware — Issue #745
 *
 * Applies correct Cache-Control, Vary, Surrogate-Control, and CDN-vendor
 * headers to every response based on:
 *   - The request path (matched against API_CACHE_RULES in cdn-geo.config.ts)
 *   - Whether the request is authenticated
 *   - The asset type (static, image, API response)
 *
 * This replaces the simple CDN header middleware (`cdn-headers.middleware.ts`)
 * with a full strategy-based approach that supports:
 *   - Geo-distributed CDN edge TTLs (Surrogate-Control for Fastly/Varnish)
 *   - Cloudflare cache-bypass hint via `Cache-Control: private` for auth routes
 *   - CloudFront cache behaviour alignment via consistent Cache-Control values
 *   - WebP negotiation via `Vary: Accept` for image routes
 *   - Cache purge tag injection via `Surrogate-Key` / `Cache-Tag` headers
 *
 * Mount this middleware AFTER authentication middleware so it can inspect
 * `req.user` to determine whether to bypass CDN caching.
 */

import { Request, Response, NextFunction } from "express";
import {
  CACHE_STRATEGIES,
  CacheStrategy,
  buildCacheControlHeader,
  buildVaryHeader,
  buildSurrogateControlHeader,
  getApiCacheStrategy,
} from "../config/cdn-geo.config";
import { CDNService } from "../services/cdn.service";
import { Logger } from "../utils/logger.utils";

// ---------------------------------------------------------------------------
// Surrogate / cache tag helper
// ---------------------------------------------------------------------------

/**
 * Returns CDN surrogate/cache tags for the response based on the request path.
 * These tags allow targeted CDN invalidation (purge by tag) without a full flush.
 *
 * - CloudFront:  `Cache-Tag` header
 * - Cloudflare:  `Cache-Tag` header
 * - Fastly:      `Surrogate-Key` header
 */
function getResponseCacheTags(path: string): string[] {
  const tags: string[] = [];

  if (path.startsWith("/api/v1/mentors")) tags.push("mentor-listings");
  if (path.startsWith("/api/v1/sessions")) tags.push("session-data");
  if (path.startsWith("/api/v1/timezones")) tags.push("timezone-list");
  if (path.startsWith("/api/v1/analytics")) tags.push("analytics");
  if (path.startsWith("/api/v1/platform-health")) tags.push("platform-health");
  if (path.startsWith("/assets/emails")) tags.push("email-assets");
  if (path.startsWith("/assets/images")) tags.push("images");
  if (path.startsWith("/assets/videos")) tags.push("videos");
  if (path.startsWith("/static")) tags.push("static");

  return tags;
}

// ---------------------------------------------------------------------------
// Smart asset strategy for non-API paths
// ---------------------------------------------------------------------------

function getStaticAssetStrategy(path: string): CacheStrategy | null {
  if (path.startsWith("/static/")) return CACHE_STRATEGIES["staticImmutable"];
  if (path.startsWith("/assets/images/")) return CACHE_STRATEGIES["images"];
  if (path.startsWith("/assets/videos/")) return CACHE_STRATEGIES["videos"];
  if (path.startsWith("/assets/emails/")) return CACHE_STRATEGIES["staticImmutable"];
  return null;
}

// ---------------------------------------------------------------------------
// Middleware factories
// ---------------------------------------------------------------------------

/**
 * Apply CDN-aware cache headers to all responses.
 *
 * Usage:
 *   app.use(smartCdnHeaders());   // apply globally after auth middleware
 */
export function smartCdnHeaders() {
  const cdnConfig = CDNService.getConfig();

  return function (req: Request, res: Response, next: NextFunction): void {
    const originalSend = res.send.bind(res);

    res.send = function (body?: unknown) {
      // Only set headers on successful responses
      if (res.statusCode >= 200 && res.statusCode < 400) {
        const path = req.path;
        const method = req.method;
        const hasAuth = !!(
          req.headers.authorization ||
          (req as any).user
        );

        let strategy: CacheStrategy;

        // Check if this is a static asset path first
        const staticStrategy = getStaticAssetStrategy(path);
        if (staticStrategy) {
          strategy = staticStrategy;
        } else {
          // Use API cache rule strategy
          strategy = getApiCacheStrategy(path, method, hasAuth);
        }

        // Set Cache-Control
        const cacheControl = buildCacheControlHeader(strategy);
        res.setHeader("Cache-Control", cacheControl);

        // Set Vary
        const vary = buildVaryHeader(strategy);
        if (vary) {
          res.setHeader("Vary", vary);
        }

        // Set Surrogate-Control (Fastly/Varnish edge TTL, separate from browser)
        const surrogateControl = buildSurrogateControlHeader(strategy);
        if (surrogateControl) {
          res.setHeader("Surrogate-Control", surrogateControl);
        }

        // Set CDN provider hint header
        if (cdnConfig) {
          res.setHeader("X-CDN-Provider", cdnConfig.provider);
        }

        // Set cache tags for targeted purging
        if (strategy.scope === "public") {
          const tags = getResponseCacheTags(path);
          if (tags.length > 0) {
            const tagString = tags.join(" ");
            // Cloudflare and CloudFront use Cache-Tag
            res.setHeader("Cache-Tag", tagString);
            // Fastly uses Surrogate-Key
            res.setHeader("Surrogate-Key", tagString);
          }
        }

        // Add CDN-Cache-Status for debugging (strips on edge before delivery)
        res.setHeader("CDN-Cache-Control", cacheControl);

        logger.debug("CDN cache headers applied", {
          path,
          method,
          hasAuth,
          cacheControl,
          scope: strategy.scope,
        });
      }

      return originalSend(body);
    };

    next();
  };
}

/**
 * Middleware that applies the IMMUTABLE cache strategy to a specific route.
 *
 * Use for static assets served with content-hash filenames:
 *   router.use("/static", immutableCdnHeaders(), express.static(...))
 */
export function immutableCdnHeaders() {
  return function (req: Request, res: Response, next: NextFunction): void {
    const originalSend = res.send.bind(res);
    res.send = function (body?: unknown) {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        res.setHeader("Cache-Control", buildCacheControlHeader(CACHE_STRATEGIES["staticImmutable"]));
        res.setHeader("Vary", "Accept-Encoding");
      }
      return originalSend(body);
    };
    next();
  };
}

/**
 * Middleware that applies the API public listing cache strategy.
 *
 * Use on specific public listing endpoints:
 *   router.get("/mentors", apiPublicCdnHeaders(), listMentorsHandler)
 */
export function apiPublicCdnHeaders(
  options: { strategy?: keyof typeof CACHE_STRATEGIES } = {},
) {
  const strategy = CACHE_STRATEGIES[options.strategy ?? "apiListings"];

  return function (req: Request, res: Response, next: NextFunction): void {
    const originalJson = res.json.bind(res);
    res.json = function (body: unknown) {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const hasAuth = !!(req.headers.authorization || (req as any).user);
        const effectiveStrategy = hasAuth
          ? CACHE_STRATEGIES["apiAuthenticated"]
          : strategy;

        res.setHeader("Cache-Control", buildCacheControlHeader(effectiveStrategy));
        const vary = buildVaryHeader(effectiveStrategy);
        if (vary) res.setHeader("Vary", vary);
        const surrogate = buildSurrogateControlHeader(effectiveStrategy);
        if (surrogate) res.setHeader("Surrogate-Control", surrogate);
      }
      return originalJson(body);
    };
    next();
  };
}

/**
 * Middleware that explicitly bypasses CDN caching.
 * Use on POST/PUT/PATCH/DELETE handlers and webhook endpoints.
 */
export function noCdnCache() {
  return function (_req: Request, res: Response, next: NextFunction): void {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache"); // IE11 / proxy compat
    next();
  };
}
