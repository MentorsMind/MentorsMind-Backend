/**
 * API gateway (issue #860).
 *
 * Sits in front of the monolith and forwards a route to an extracted service
 * once one is registered for it. Everything else falls through untouched, so
 * this is safe to mount before any service exists — with an empty registry it
 * is a no-op.
 *
 * The migration is a strangler-fig, and the fallback is the point: if a service
 * is unregistered, unhealthy, or its circuit is open, the request goes to the
 * monolith, which still contains the code.
 */

import type { NextFunction, Request, Response } from "express";
import { logger } from "../../utils/logger";
import {
  pickInstance,
  recordInstanceResult,
  resolveService,
} from "./service-registry";
import { canAttempt, recordFailure, recordSuccess } from "./circuit-breaker";
import { buildTraceHeaders } from "./tracing";

export * from "./service-registry";
export * from "./circuit-breaker";
export * from "./tracing";

export interface GatewayOptions {
  /** Upstream timeout before falling back to the monolith. */
  timeoutMs?: number;
  /** Set false to observe routing decisions without forwarding. */
  enabled?: boolean;
}

/**
 * Forward matching requests to their service.
 *
 * Deliberately fails *open*: any error forwarding results in `next()`, so a
 * gateway defect degrades to the pre-migration behaviour instead of taking the
 * route down.
 */
export function gatewayMiddleware(options: GatewayOptions = {}) {
  const timeoutMs = options.timeoutMs ?? 5000;
  const enabled = options.enabled ?? true;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!enabled) return next();

    const definition = resolveService(req.path);
    if (!definition) return next();

    const breakerKey = definition.name;
    if (!canAttempt(breakerKey)) {
      logger.debug({ service: definition.name }, "Circuit open; serving from monolith");
      return next();
    }

    const instance = pickInstance(definition.name);
    if (!instance) return next();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const target = `${instance.url}${req.originalUrl}`;
      const upstream = await fetch(target, {
        method: req.method,
        headers: {
          ...forwardableHeaders(req),
          ...buildTraceHeaders(req),
        },
        body: ["GET", "HEAD"].includes(req.method) ? undefined : JSON.stringify(req.body),
        signal: controller.signal,
      });

      recordInstanceResult(definition.name, instance.url, upstream.ok);
      if (upstream.ok) recordSuccess(breakerKey);
      else recordFailure(breakerKey);

      // A 5xx from the service is treated as a service failure and falls back;
      // a 4xx is a real answer about the request and is passed through.
      if (upstream.status >= 500) return next();

      res.status(upstream.status);
      upstream.headers.forEach((value, key) => {
        if (!["content-encoding", "transfer-encoding", "connection"].includes(key)) {
          res.setHeader(key, value);
        }
      });
      res.send(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) {
      recordInstanceResult(definition.name, instance.url, false);
      recordFailure(breakerKey);
      logger.warn(
        {
          service: definition.name,
          error: error instanceof Error ? error.message : String(error),
        },
        "Gateway forward failed; falling back to monolith",
      );
      next();
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Hop-by-hop headers must not be forwarded. */
function forwardableHeaders(req: Request): Record<string, string> {
  const skip = new Set([
    "host",
    "connection",
    "keep-alive",
    "transfer-encoding",
    "upgrade",
    "proxy-authorization",
    "content-length",
  ]);

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (skip.has(key.toLowerCase())) continue;
    if (typeof value === "string") out[key] = value;
  }
  if (!out["content-type"]) out["content-type"] = "application/json";
  return out;
}
