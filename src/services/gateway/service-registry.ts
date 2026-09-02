/**
 * Service registry and discovery (issue #860).
 *
 * The migration this supports is a strangler-fig: the monolith keeps serving
 * every route until a service is registered for it, at which point the gateway
 * starts forwarding that prefix instead. Nothing is cut over by deploying this
 * file — a service only takes traffic once it is registered *and* healthy.
 */

import { logger } from "../../utils/logger";

export type ServiceName = "user-service" | "booking-service" | "payment-service";

export interface ServiceInstance {
  /** Base URL including scheme, no trailing slash. */
  url: string;
  healthy: boolean;
  consecutiveFailures: number;
  lastCheckedAt: number;
}

export interface ServiceDefinition {
  name: ServiceName;
  /** Route prefixes this service owns, e.g. ["/api/users"]. */
  prefixes: string[];
  instances: ServiceInstance[];
  /** Health endpoint path, relative to each instance URL. */
  healthPath: string;
  /** Failures before an instance leaves rotation. */
  unhealthyThreshold: number;
}

const registry = new Map<ServiceName, ServiceDefinition>();
const cursors = new Map<ServiceName, number>();

/** Register or replace a service definition. */
export function registerService(definition: ServiceDefinition): void {
  registry.set(definition.name, definition);
  cursors.set(definition.name, 0);
  logger.info(
    { service: definition.name, prefixes: definition.prefixes, instances: definition.instances.length },
    "Service registered with gateway",
  );
}

export function deregisterService(name: ServiceName): void {
  registry.delete(name);
  cursors.delete(name);
  logger.info({ service: name }, "Service deregistered; traffic returns to the monolith");
}

export function listServices(): ServiceDefinition[] {
  return [...registry.values()];
}

/**
 * Find the service owning a path.
 *
 * Longest prefix wins, so `/api/users/billing` can be split out to a payment
 * service later without `/api/users` swallowing it first.
 */
export function resolveService(path: string): ServiceDefinition | null {
  let best: ServiceDefinition | null = null;
  let bestLength = -1;

  for (const definition of registry.values()) {
    for (const prefix of definition.prefixes) {
      if (path === prefix || path.startsWith(`${prefix}/`)) {
        if (prefix.length > bestLength) {
          best = definition;
          bestLength = prefix.length;
        }
      }
    }
  }

  return best;
}

/**
 * Next healthy instance, round-robin.
 *
 * Returns null when every instance is unhealthy, which the gateway treats as
 * "fall back to the monolith" rather than as an error — during migration the
 * monolith still has the code.
 */
export function pickInstance(name: ServiceName): ServiceInstance | null {
  const definition = registry.get(name);
  if (!definition) return null;

  const healthy = definition.instances.filter((i) => i.healthy);
  if (healthy.length === 0) return null;

  const cursor = cursors.get(name) ?? 0;
  const instance = healthy[cursor % healthy.length];
  cursors.set(name, (cursor + 1) % healthy.length);
  return instance;
}

export function recordInstanceResult(
  name: ServiceName,
  url: string,
  ok: boolean,
): void {
  const definition = registry.get(name);
  const instance = definition?.instances.find((i) => i.url === url);
  if (!definition || !instance) return;

  instance.lastCheckedAt = Date.now();

  if (ok) {
    instance.consecutiveFailures = 0;
    if (!instance.healthy) {
      instance.healthy = true;
      logger.info({ service: name, url }, "Service instance returned to rotation");
    }
    return;
  }

  instance.consecutiveFailures += 1;
  if (
    instance.healthy &&
    instance.consecutiveFailures >= definition.unhealthyThreshold
  ) {
    instance.healthy = false;
    logger.warn({ service: name, url }, "Service instance removed from rotation");
  }
}

/** Test hook. */
export function clearRegistry(): void {
  registry.clear();
  cursors.clear();
}
