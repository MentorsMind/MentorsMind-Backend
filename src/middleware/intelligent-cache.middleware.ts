/**
 * Response caching driven by the cache orchestrator (issue #864).
 *
 * `cacheMiddleware` caches a response body in Redis under the request URL. This
 * middleware adds the parts that need the tier hierarchy:
 *
 *   - L1 hits, so a hot endpoint never leaves the process
 *   - dependency tags, so a mentor update drops every response mentioning them
 *   - stale-while-revalidate, so an expiring key does not stall a request
 *
 * Private responses are still scoped to the caller by an HMAC of the user id,
 * reusing `signUserId` so both middlewares derive the same identity.
 */

import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import {
  cacheOrchestrator,
  CacheOrchestrator,
  CacheTier,
} from "../services/cache-orchestrator.service";
import { signUserId } from "./cache.middleware";

export interface CachedResponse {
  status: number;
  body: unknown;
  /** Response headers replayed on a hit. */
  headers: Record<string, string>;
}

export interface IntelligentCacheOptions {
  /** Cache namespace; becomes the key prefix and the analytics grouping. */
  namespace: string;
  ttl?: number;
  /**
   * Dependency tags for the response. Given the request so a tag can name the
   * specific entity, e.g. `req => ['mentor:' + req.params.id]`.
   */
  dependencies?: (req: Request) => string[];
  /** Request headers folded into the key, e.g. `['accept-language']`. */
  vary?: string[];
  /** Cache responses for authenticated callers, scoped to the caller. */
  cacheAuthenticated?: boolean;
  /** Serve an expired entry while refreshing behind the request. */
  staleWhileRevalidate?: boolean;
  /** Tiers to write to. Defaults to L1 + L2. */
  tiers?: CacheTier[];
  /** Skip caching for a specific request. */
  skip?: (req: Request) => boolean;
  orchestrator?: CacheOrchestrator;
}

/** Headers worth replaying; anything hop-by-hop or connection-specific is not. */
const REPLAYED_HEADERS = ["content-type", "content-language", "etag"];

export function buildCacheKey(
  req: Request,
  options: IntelligentCacheOptions,
): string {
  const parts = [req.originalUrl];

  for (const header of options.vary ?? []) {
    const value = req.headers[header.toLowerCase()];
    parts.push(
      `${header}=${Array.isArray(value) ? value.join(",") : (value ?? "")}`,
    );
  }

  if (options.cacheAuthenticated) {
    const user = (req as any).user;
    const userId = user?.userId ?? user?.id;
    if (userId) parts.push(`u=${signUserId(String(userId))}`);
  }

  // The URL can be long and carries user input; hashing keeps keys bounded and
  // keeps raw query strings out of Redis.
  const digest = crypto
    .createHash("sha256")
    .update(parts.join("|"))
    .digest("hex")
    .slice(0, 32);
  return `${options.namespace}:http:${digest}`;
}

/**
 * Cache a GET response through the orchestrator.
 *
 * @example
 * router.get(
 *   '/mentors/:id',
 *   intelligentCache({
 *     namespace: 'mentors',
 *     ttl: 300,
 *     dependencies: (req) => [`mentor:${req.params.id}`],
 *     staleWhileRevalidate: true,
 *   }),
 *   handler,
 * );
 */
export function intelligentCache(options: IntelligentCacheOptions) {
  const orchestrator = options.orchestrator ?? cacheOrchestrator;

  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    if (req.method !== "GET") return next();
    if (options.skip?.(req)) return next();

    const isAuthed = !!(req as any).user;
    if (isAuthed && !options.cacheAuthenticated) return next();

    const key = buildCacheKey(req, options);
    const dependencies = options.dependencies?.(req) ?? [];

    // The loader rejects rather than resolving, so a miss falls through to the
    // route handler instead of caching a placeholder.
    let served = false;
    try {
      const result = await orchestrator.get<CachedResponse>(
        key,
        () => Promise.reject(new CacheMiss()),
        {
          ttl: options.ttl,
          dependencies,
          tiers: options.tiers,
          staleWhileRevalidate: options.staleWhileRevalidate,
        },
      );

      if (result.value) {
        served = true;
        res.setHeader("X-Cache", result.stale ? "STALE" : "HIT");
        res.setHeader("X-Cache-Tier", result.tier ?? "unknown");
        for (const [name, value] of Object.entries(result.value.headers)) {
          res.setHeader(name, value);
        }
        res.status(result.value.status).json(result.value.body);
        return;
      }
    } catch (err) {
      if (!(err instanceof CacheMiss)) {
        // A cache failure must not fail the request; fall through uncached.
        res.setHeader("X-Cache", "ERROR");
      }
    }

    if (served) return;

    res.setHeader("X-Cache", "MISS");

    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      if (res.statusCode < 400) {
        const headers: Record<string, string> = {};
        for (const name of REPLAYED_HEADERS) {
          const value = res.getHeader(name);
          if (typeof value === "string") headers[name] = value;
        }

        void orchestrator
          .set<CachedResponse>(
            key,
            { status: res.statusCode, body, headers },
            {
              ttl: options.ttl,
              dependencies,
              tiers: options.tiers,
            },
          )
          .catch(() => {
            /* caching is best-effort */
          });
      }
      return originalJson(body);
    };

    next();
  };
}

/** Signals "nothing cached" without the loader inventing a value. */
export class CacheMiss extends Error {
  constructor() {
    super("cache miss");
    this.name = "CacheMiss";
  }
}

/**
 * Invalidate every cached response that declared any of `tags`.
 *
 * Call from a write path — after updating a mentor, `invalidateDependencies(['mentor:42'])`.
 */
export async function invalidateDependencies(
  tags: string[],
  orchestrator: CacheOrchestrator = cacheOrchestrator,
): Promise<string[]> {
  return orchestrator.invalidateTags(tags);
}
