/**
 * Service registry & discovery
 *
 * Holds the catalogue of logical services and their upstream instances, and
 * runs periodic health checks so the load balancer only sees live instances.
 *
 * Services can be seeded statically from `GATEWAY_SERVICES` (see
 * `gateway.config.ts`) or registered/deregistered at runtime via the gateway
 * management API — this is the "service discovery" side of the pattern:
 * instances self-register on boot and de-register on shutdown.
 */

import { EventEmitter } from "events";
import axios from "axios";
import type {
  RegisterInstanceInput,
  ServiceDefinition,
  ServiceInstance,
} from "./types";
import gatewayConfig from "./gateway.config";
import { CircuitBreaker } from "./circuit-breaker";
import { logger } from "../utils/logger";

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function makeInstance(
  url: string,
  weight = 1,
  metadata: Record<string, string> = {},
): ServiceInstance {
  const clean = normalizeUrl(url);
  return {
    id: clean.replace(/^https?:\/\//, ""),
    url: clean,
    weight: weight > 0 ? weight : 1,
    health: "unknown",
    activeConnections: 0,
    lastCheckedAt: null,
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    metadata,
  };
}

export class ServiceRegistry extends EventEmitter {
  private readonly services = new Map<string, ServiceDefinition>();
  private readonly breakers = new Map<string, CircuitBreaker>();
  private healthTimer: NodeJS.Timeout | null = null;

  constructor() {
    super();
    for (const svc of gatewayConfig.staticServices) {
      this.services.set(svc.name, svc);
      this.breakers.set(svc.name, this.newBreaker());
    }
  }

  private newBreaker(): CircuitBreaker {
    return new CircuitBreaker({
      failureThreshold: gatewayConfig.circuitBreaker.failureThreshold,
      resetTimeoutMs: gatewayConfig.circuitBreaker.resetTimeoutMs,
    });
  }

  // -------------------------------------------------------------------------
  // Discovery / catalogue
  // -------------------------------------------------------------------------

  listServices(): ServiceDefinition[] {
    return [...this.services.values()];
  }

  getService(name: string): ServiceDefinition | undefined {
    return this.services.get(name);
  }

  getBreaker(name: string): CircuitBreaker {
    let breaker = this.breakers.get(name);
    if (!breaker) {
      breaker = this.newBreaker();
      this.breakers.set(name, breaker);
    }
    return breaker;
  }

  /** Resolve the service whose prefix matches the start of `path`. */
  matchServiceByPath(path: string): ServiceDefinition | undefined {
    let match: ServiceDefinition | undefined;
    for (const svc of this.services.values()) {
      if (path === svc.prefix || path.startsWith(`${svc.prefix}/`)) {
        // Prefer the most specific (longest) prefix.
        if (!match || svc.prefix.length > match.prefix.length) match = svc;
      }
    }
    return match;
  }

  // -------------------------------------------------------------------------
  // Runtime registration (service discovery)
  // -------------------------------------------------------------------------

  registerInstance(input: RegisterInstanceInput): ServiceDefinition {
    const name = input.service;
    if (!name || !input.url) {
      throw new Error("register requires `service` and `url`");
    }

    let svc = this.services.get(name);
    if (!svc) {
      const prefix = input.prefix || `/${name}`;
      svc = {
        name,
        prefix: prefix.startsWith("/") ? prefix : `/${prefix}`,
        instances: [],
        healthCheckPath: input.healthCheckPath || "/health",
        dynamic: true,
      };
      this.services.set(name, svc);
      this.breakers.set(name, this.newBreaker());
    }

    const instance = makeInstance(input.url, input.weight, input.metadata);
    const existing = svc.instances.find((i) => i.id === instance.id);
    if (existing) {
      existing.weight = instance.weight;
      existing.metadata = instance.metadata;
      logger.info("Gateway: refreshed service instance", {
        service: name,
        instance: instance.id,
      });
    } else {
      svc.instances.push(instance);
      logger.info("Gateway: registered service instance", {
        service: name,
        instance: instance.id,
      });
      this.emit("instance:registered", { service: name, instance });
      // Probe the new instance immediately rather than waiting a full interval.
      void this.checkInstance(svc, instance);
    }

    return svc;
  }

  deregisterInstance(name: string, url: string): boolean {
    const svc = this.services.get(name);
    if (!svc) return false;
    const id = normalizeUrl(url).replace(/^https?:\/\//, "");
    const before = svc.instances.length;
    svc.instances = svc.instances.filter((i) => i.id !== id);
    const removed = svc.instances.length < before;

    if (removed) {
      logger.info("Gateway: deregistered service instance", {
        service: name,
        instance: id,
      });
      this.emit("instance:deregistered", { service: name, instance: id });
    }
    if (svc.instances.length === 0 && svc.dynamic) {
      this.services.delete(name);
      this.breakers.delete(name);
    }
    return removed;
  }

  // -------------------------------------------------------------------------
  // Health checking
  // -------------------------------------------------------------------------

  startHealthChecks(): void {
    if (this.healthTimer || !gatewayConfig.healthCheck.enabled) return;
    const run = () => void this.checkAll();
    this.healthTimer = setInterval(run, gatewayConfig.healthCheck.intervalMs);
    this.healthTimer.unref?.();
    run();
  }

  stopHealthChecks(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  async checkAll(): Promise<void> {
    const probes: Array<Promise<void>> = [];
    for (const svc of this.services.values()) {
      for (const instance of svc.instances) {
        probes.push(this.checkInstance(svc, instance));
      }
    }
    await Promise.allSettled(probes);
  }

  async checkInstance(
    svc: ServiceDefinition,
    instance: ServiceInstance,
  ): Promise<void> {
    const { healthyThreshold, unhealthyThreshold, timeoutMs } =
      gatewayConfig.healthCheck;
    const target = `${instance.url}${svc.healthCheckPath}`;

    try {
      const res = await axios.get(target, {
        timeout: timeoutMs,
        // Any 2xx/3xx counts as alive; upstreams vary.
        validateStatus: (s) => s < 500,
      });
      const ok = res.status < 400;
      if (!ok) throw new Error(`status ${res.status}`);

      instance.consecutiveSuccesses += 1;
      instance.consecutiveFailures = 0;
      if (
        instance.health !== "healthy" &&
        instance.consecutiveSuccesses >= healthyThreshold
      ) {
        instance.health = "healthy";
        this.emit("instance:healthy", { service: svc.name, instance });
        logger.info("Gateway: instance healthy", {
          service: svc.name,
          instance: instance.id,
        });
      }
    } catch (err) {
      instance.consecutiveFailures += 1;
      instance.consecutiveSuccesses = 0;
      if (
        instance.health !== "unhealthy" &&
        instance.consecutiveFailures >= unhealthyThreshold
      ) {
        instance.health = "unhealthy";
        this.emit("instance:unhealthy", { service: svc.name, instance });
        logger.warn("Gateway: instance unhealthy", {
          service: svc.name,
          instance: instance.id,
          error: (err as Error).message,
        });
      }
    } finally {
      instance.lastCheckedAt = Date.now();
    }
  }

  reset(): void {
    this.stopHealthChecks();
    this.services.clear();
    this.breakers.clear();
  }
}

let singleton: ServiceRegistry | null = null;

export function getServiceRegistry(): ServiceRegistry {
  if (!singleton) singleton = new ServiceRegistry();
  return singleton;
}

/** Test helper — drops the singleton so a fresh registry is built next call. */
export function __resetServiceRegistry(): void {
  singleton?.reset();
  singleton = null;
}
