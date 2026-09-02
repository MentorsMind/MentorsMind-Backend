/**
 * Service Discovery Middleware
 *
 * Bridges the API gateway's service registry into the normal Express request
 * lifecycle. For every request it:
 *   - resolves which registered service (if any) owns the request path
 *   - attaches a lightweight discovery handle to `req.serviceDiscovery` so
 *     downstream handlers can look up a healthy instance for east-west calls
 *   - sets `X-Discovered-Service` / `X-Discovered-Instance` response headers
 *
 * It never proxies or blocks — routing/rate limiting/load balancing live in
 * `getApiGateway().middleware()`. This middleware is purely additive context
 * and is safe to mount globally even when the gateway proxy is disabled.
 */

import { Request, Response, NextFunction } from "express";
import { getServiceRegistry } from "../gateway/service-registry";
import { selectInstance } from "../gateway/load-balancer";
import gatewayConfig from "../gateway/gateway.config";
import type { LoadBalancingStrategy, ServiceInstance } from "../gateway/types";
import { logger } from "../utils/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiscoveredInstance {
  id: string;
  url: string;
  health: ServiceInstance["health"];
}

export interface ServiceDiscoveryHandle {
  /** The service that owns the current request path, if any. */
  matchedService: string | null;
  /** Resolve a healthy base URL for `serviceName`, or null if none available. */
  resolve(serviceName: string): DiscoveredInstance | null;
  /** All known instances for `serviceName` (any health). */
  instances(serviceName: string): DiscoveredInstance[];
  /** Names of every registered service. */
  services(): string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      serviceDiscovery?: ServiceDiscoveryHandle;
    }
  }
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

function toDiscovered(instance: ServiceInstance): DiscoveredInstance {
  return { id: instance.id, url: instance.url, health: instance.health };
}

export function serviceDiscoveryMiddleware() {
  const registry = getServiceRegistry();

  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const matched = registry.matchServiceByPath(req.path);

      const handle: ServiceDiscoveryHandle = {
        matchedService: matched?.name ?? null,

        resolve(serviceName: string): DiscoveredInstance | null {
          const svc = registry.getService(serviceName);
          if (!svc || svc.instances.length === 0) return null;
          const strategy: LoadBalancingStrategy =
            svc.strategy ?? gatewayConfig.defaultStrategy;
          const instance = selectInstance(svc, strategy);
          return instance ? toDiscovered(instance) : null;
        },

        instances(serviceName: string): DiscoveredInstance[] {
          const svc = registry.getService(serviceName);
          return svc ? svc.instances.map(toDiscovered) : [];
        },

        services(): string[] {
          return registry.listServices().map((s) => s.name);
        },
      };

      req.serviceDiscovery = handle;

      if (matched) {
        res.setHeader("X-Discovered-Service", matched.name);
        const instance = handle.resolve(matched.name);
        if (instance) res.setHeader("X-Discovered-Instance", instance.id);
      }

      next();
    } catch (err) {
      // Discovery is best-effort; never break the request path.
      logger.warn("Service discovery middleware error", {
        error: (err as Error).message,
      });
      next();
    }
  };
}

export default serviceDiscoveryMiddleware;
