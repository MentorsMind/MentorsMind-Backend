/**
 * Edge function registry and dispatcher (issue #863).
 *
 * Edge functions are small, synchronous-ish transforms that run per request:
 * geo routing, A/B bucketing, header rewriting, redirect rules. Each provider
 * (CloudFront Functions, Cloudflare Workers, Fastly Compute) has its own
 * deployment story, so this service owns the parts that are ours:
 *
 *   - a registry of functions with the routes they apply to
 *   - a dispatcher that runs them in order against a request context
 *   - a hard timeout, because an edge function that hangs is worse than absent
 *   - a deployment manifest that a provider-specific step can consume
 *
 * Running the same logic here and at the edge means a request served from the
 * origin behaves the same as one served from a POP.
 */

import { Logger } from "../utils/logger";
import {
  cdnConfig,
  type CDNConfiguration,
  type CDNProviderName,
} from "../config/cdn.config";

const logger = new Logger("EdgeFunctions");

export type EdgeTrigger = "viewer-request" | "viewer-response";

export interface EdgeRequestContext {
  path: string;
  method: string;
  headers: Record<string, string>;
  /** ISO country code resolved by the CDN, when it supplies one. */
  country?: string;
  query: Record<string, string>;
}

export interface EdgeResult {
  /** Headers to add or overwrite. */
  headers?: Record<string, string>;
  /** Rewrite the origin path. */
  rewritePath?: string;
  /** Short-circuit with a redirect. Stops the chain. */
  redirect?: { status: 301 | 302 | 307 | 308; location: string };
  /** Short-circuit with a response. Stops the chain. */
  respond?: { status: number; body: string };
}

export interface EdgeFunction {
  name: string;
  trigger: EdgeTrigger;
  /** Path prefixes this applies to. Empty means every path. */
  routes: string[];
  /** Lower runs first. */
  priority?: number;
  handler: (ctx: EdgeRequestContext) => EdgeResult | Promise<EdgeResult>;
}

export interface EdgeExecution {
  context: EdgeRequestContext;
  /** Functions that ran, in order. */
  applied: string[];
  /** Functions that timed out or threw, with the reason. */
  failed: Array<{ name: string; reason: string }>;
  result: EdgeResult;
}

export interface EdgeDeploymentManifest {
  provider: CDNProviderName;
  regions: string[];
  functions: Array<{
    name: string;
    trigger: EdgeTrigger;
    routes: string[];
    priority: number;
  }>;
}

export class EdgeFunctionTimeout extends Error {
  constructor(name: string, timeoutMs: number) {
    super(`edge function "${name}" exceeded ${timeoutMs}ms`);
    this.name = "EdgeFunctionTimeout";
  }
}

export class EdgeFunctionsService {
  private functions = new Map<string, EdgeFunction>();

  constructor(private readonly config: CDNConfiguration = cdnConfig) {}

  register(fn: EdgeFunction): void {
    this.functions.set(fn.name, fn);
  }

  unregister(name: string): void {
    this.functions.delete(name);
  }

  list(): EdgeFunction[] {
    return [...this.functions.values()].sort(
      (a, b) => (a.priority ?? 100) - (b.priority ?? 100),
    );
  }

  /** Functions that apply to a path for a trigger, in priority order. */
  matching(trigger: EdgeTrigger, path: string): EdgeFunction[] {
    return this.list().filter(
      (fn) =>
        fn.trigger === trigger &&
        (fn.routes.length === 0 ||
          fn.routes.some((route) => path.startsWith(route))),
    );
  }

  /**
   * Run the chain for a request.
   *
   * Results merge: later headers overwrite earlier ones, the last rewrite wins,
   * and the first redirect or response ends the chain. A function that throws
   * or overruns its budget is skipped and recorded — one broken transform must
   * not take the request down with it.
   */
  async execute(
    trigger: EdgeTrigger,
    context: EdgeRequestContext,
  ): Promise<EdgeExecution> {
    const execution: EdgeExecution = {
      context,
      applied: [],
      failed: [],
      result: { headers: {} },
    };

    if (!this.config.edge.enabled) return execution;

    for (const fn of this.matching(trigger, context.path)) {
      try {
        const result = await withTimeout(
          Promise.resolve(fn.handler(context)),
          this.config.edge.timeoutMs,
          fn.name,
        );
        execution.applied.push(fn.name);

        if (result.headers) {
          execution.result.headers = {
            ...execution.result.headers,
            ...result.headers,
          };
        }
        if (result.rewritePath)
          execution.result.rewritePath = result.rewritePath;
        if (result.redirect) {
          execution.result.redirect = result.redirect;
          break;
        }
        if (result.respond) {
          execution.result.respond = result.respond;
          break;
        }
      } catch (err) {
        const reason = (err as Error).message;
        execution.failed.push({ name: fn.name, reason });
        logger.warn(`Edge function ${fn.name} skipped: ${reason}`);
      }
    }

    return execution;
  }

  /** Describe the registered functions for a provider's deployment step. */
  manifest(
    provider: CDNProviderName = this.config.primary,
  ): EdgeDeploymentManifest {
    return {
      provider,
      regions: this.config.edge.regions,
      functions: this.list().map((fn) => ({
        name: fn.name,
        trigger: fn.trigger,
        routes: fn.routes,
        priority: fn.priority ?? 100,
      })),
    };
  }
}

/**
 * Reject once `timeoutMs` elapses.
 *
 * The underlying promise is not cancellable, so it keeps running; the point is
 * to stop the request waiting on it.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  name: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new EdgeFunctionTimeout(name, timeoutMs)),
          timeoutMs,
        );
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ─── Built-in functions ──────────────────────────────────────────────────────

/**
 * Route a request to the nearest content variant by country.
 *
 * `regionMap` maps ISO country codes to a region slug; unmapped countries fall
 * through to `defaultRegion`.
 */
export function geoRoutingFunction(
  regionMap: Record<string, string>,
  defaultRegion: string,
): EdgeFunction {
  return {
    name: "geo-routing",
    trigger: "viewer-request",
    routes: [],
    priority: 10,
    handler: (ctx) => {
      const region =
        (ctx.country && regionMap[ctx.country.toUpperCase()]) || defaultRegion;
      return { headers: { "x-mm-region": region } };
    },
  };
}

/** Add the cache-relevant Vary header for negotiated image responses. */
export function imageVaryFunction(): EdgeFunction {
  return {
    name: "image-vary",
    trigger: "viewer-response",
    routes: ["/api/v1/media", "/assets"],
    priority: 20,
    handler: () => ({ headers: { vary: "Accept, Accept-Encoding" } }),
  };
}

export const edgeFunctions = new EdgeFunctionsService();
