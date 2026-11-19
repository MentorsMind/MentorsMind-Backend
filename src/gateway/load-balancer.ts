/**
 * Load balancer
 *
 * Pure, stateless-ish strategy implementations for picking one healthy upstream
 * instance out of a service's pool. Round-robin cursors are kept per service
 * name in a small module-local map so selection is stable across calls.
 */

import type {
  LoadBalancingStrategy,
  ServiceDefinition,
  ServiceInstance,
} from "./types";

const roundRobinCursors = new Map<string, number>();

/** Instances eligible to receive traffic: healthy, or unknown (not yet probed). */
export function eligibleInstances(
  service: ServiceDefinition,
): ServiceInstance[] {
  const usable = service.instances.filter((i) => i.health !== "unhealthy");
  // If every instance is unhealthy, fall back to the full pool so the gateway
  // still attempts delivery rather than hard-failing.
  return usable.length > 0 ? usable : service.instances;
}

function pickRoundRobin(
  key: string,
  instances: ServiceInstance[],
): ServiceInstance {
  const next = (roundRobinCursors.get(key) ?? 0) % instances.length;
  roundRobinCursors.set(key, next + 1);
  return instances[next];
}

function pickWeighted(
  key: string,
  instances: ServiceInstance[],
): ServiceInstance {
  // Expand by weight then round-robin over the expansion. Cheap and correct for
  // the small instance counts a gateway realistically handles.
  const expanded: ServiceInstance[] = [];
  for (const instance of instances) {
    const w = Math.max(1, Math.floor(instance.weight));
    for (let n = 0; n < w; n += 1) expanded.push(instance);
  }
  return pickRoundRobin(`${key}:weighted`, expanded);
}

function pickLeastConnections(instances: ServiceInstance[]): ServiceInstance {
  return instances.reduce((best, current) =>
    current.activeConnections < best.activeConnections ? current : best,
  );
}

function pickRandom(instances: ServiceInstance[]): ServiceInstance {
  return instances[Math.floor(Math.random() * instances.length)];
}

/**
 * Select an instance for a service using the given strategy.
 * Returns `null` when the service has no instances at all.
 */
export function selectInstance(
  service: ServiceDefinition,
  strategy: LoadBalancingStrategy,
): ServiceInstance | null {
  const pool = eligibleInstances(service);
  if (pool.length === 0) return null;
  if (pool.length === 1) return pool[0];

  switch (strategy) {
    case "least-connections":
      return pickLeastConnections(pool);
    case "random":
      return pickRandom(pool);
    case "weighted-round-robin":
      return pickWeighted(service.name, pool);
    case "round-robin":
    default:
      return pickRoundRobin(service.name, pool);
  }
}

/** Test/administrative helper — clears round-robin cursors. */
export function resetLoadBalancerState(): void {
  roundRobinCursors.clear();
}
