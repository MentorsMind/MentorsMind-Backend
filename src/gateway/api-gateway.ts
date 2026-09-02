/**
 * API Gateway orchestrator
 *
 * Ties the pieces together — service registry/discovery, health checking,
 * token-bucket rate limiting, load balancing, circuit breaking and reverse
 * proxying — behind a single Express middleware plus a stats accessor for the
 * monitoring endpoint.
 *
 * Wiring (opt-in, see `gateway.config.ts` — disabled unless GATEWAY_ENABLED):
 *   app.use(getApiGateway().middleware());
 */

import type { NextFunction, Request, Response } from "express";
import gatewayConfig from "./gateway.config";
import { getServiceRegistry, ServiceRegistry } from "./service-registry";
import { RequestRouter } from "./request-router";
import { TokenBucketRateLimiter } from "./rate-limiter";
import type { GatewayStats, LoadBalancingStrategy } from "./types";
import { logger } from "../utils/logger";

export class ApiGateway {
  readonly registry: ServiceRegistry;
  private readonly router: RequestRouter;
  private readonly rateLimiter: TokenBucketRateLimiter;
  private started = false;
  private startedAt = Date.now();

  private counters = {
    totalRequests: 0,
    totalErrors: 0,
    rateLimited: 0,
    circuitTrips: 0,
  };

  constructor(registry: ServiceRegistry = getServiceRegistry()) {
    this.registry = registry;
    this.router = new RequestRouter(registry);
    this.rateLimiter = new TokenBucketRateLimiter({
      requestsPerWindow: gatewayConfig.rateLimit.requestsPerWindow,
      windowMs: gatewayConfig.rateLimit.windowMs,
      burst: gatewayConfig.rateLimit.burst,
    });
  }

  /** Start background work (health checks, limiter sweep). Idempotent. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.startedAt = Date.now();
    if (gatewayConfig.rateLimit.enabled) this.rateLimiter.start();
    this.registry.startHealthChecks();
    logger.info("API gateway started", {
      strategy: gatewayConfig.defaultStrategy,
      services: this.registry.listServices().map((s) => s.name),
    });
  }

  stop(): void {
    this.started = false;
    this.rateLimiter.stop();
    this.registry.stopHealthChecks();
  }

  private clientKey(req: Request): string {
    const user = (req as { user?: { id?: string } }).user;
    if (user?.id) return `user:${user.id}`;
    const apiKey = req.headers["x-api-key"];
    if (typeof apiKey === "string" && apiKey) return `key:${apiKey.slice(0, 16)}`;
    return `ip:${req.ip}`;
  }

  /**
   * Express middleware. Non-gateway paths (no matching service prefix) are
   * passed straight through so this can sit early in the stack safely.
   */
  middleware() {
    return async (req: Request, res: Response, next: NextFunction) => {
      if (!gatewayConfig.enabled) return next();

      const resolution = this.router.resolve(req.path);
      if (!resolution) return next();

      this.counters.totalRequests += 1;

      // --- Rate limiting -------------------------------------------------
      if (gatewayConfig.rateLimit.enabled) {
        const key = `${this.clientKey(req)}|${resolution.service.name}`;
        const verdict = this.rateLimiter.consume(key);
        res.setHeader("x-ratelimit-limit", verdict.limit);
        res.setHeader("x-ratelimit-remaining", verdict.remaining);
        if (!verdict.allowed) {
          this.counters.rateLimited += 1;
          res.setHeader("retry-after", Math.ceil(verdict.retryAfterMs / 1000));
          return res.status(429).json({
            status: "error",
            message: "Too many requests — gateway rate limit exceeded",
            retryAfterMs: verdict.retryAfterMs,
            timestamp: new Date().toISOString(),
          });
        }
      }

      // --- Circuit breaker --------------------------------------------------
      const breaker = this.registry.getBreaker(resolution.service.name);
      if (gatewayConfig.circuitBreaker.enabled && !breaker.canRequest()) {
        this.counters.totalErrors += 1;
        res.setHeader("retry-after", Math.ceil(
          gatewayConfig.circuitBreaker.resetTimeoutMs / 1000,
        ));
        return res.status(503).json({
          status: "error",
          message: `Service '${resolution.service.name}' is temporarily unavailable (circuit open)`,
          timestamp: new Date().toISOString(),
        });
      }

      // --- Proxy ----------------------------------------------------------
      try {
        const outcome = await this.router.forward(req, res, resolution);
        if (gatewayConfig.circuitBreaker.enabled) {
          if (outcome.failed) {
            const before = breaker.getTripCount();
            breaker.recordFailure();
            if (breaker.getTripCount() > before) this.counters.circuitTrips += 1;
          } else {
            breaker.recordSuccess();
          }
        }
        if (outcome.failed) this.counters.totalErrors += 1;
        res.setHeader("x-gateway-service", resolution.service.name);
      } catch (err) {
        this.counters.totalErrors += 1;
        if (gatewayConfig.circuitBreaker.enabled) breaker.recordFailure();
        logger.error("Gateway proxy error", { error: (err as Error).message });
        if (!res.headersSent) {
          res.status(502).json({
            status: "error",
            message: "Bad gateway",
            timestamp: new Date().toISOString(),
          });
        }
      }
    };
  }

  getStats(): GatewayStats {
    return {
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      totalRequests: this.counters.totalRequests,
      totalErrors: this.counters.totalErrors,
      rateLimited: this.counters.rateLimited,
      circuitTrips: this.counters.circuitTrips,
      services: this.registry.listServices().map((svc) => ({
        name: svc.name,
        prefix: svc.prefix,
        strategy: (svc.strategy ??
          gatewayConfig.defaultStrategy) as LoadBalancingStrategy,
        circuit: this.registry.getBreaker(svc.name).getState(),
        instances: svc.instances.map((i) => ({
          id: i.id,
          url: i.url,
          health: i.health,
          weight: i.weight,
          activeConnections: i.activeConnections,
          consecutiveFailures: i.consecutiveFailures,
          lastCheckedAt: i.lastCheckedAt,
        })),
      })),
    };
  }
}

let singleton: ApiGateway | null = null;

export function getApiGateway(): ApiGateway {
  if (!singleton) singleton = new ApiGateway();
  return singleton;
}

export function __resetApiGateway(): void {
  singleton?.stop();
  singleton = null;
}
