import {
  selectInstance,
  eligibleInstances,
  resetLoadBalancerState,
} from "../load-balancer";
import type { ServiceDefinition, ServiceInstance } from "../types";

function instance(id: string, over: Partial<ServiceInstance> = {}): ServiceInstance {
  return {
    id,
    url: `http://${id}`,
    weight: 1,
    health: "healthy",
    activeConnections: 0,
    lastCheckedAt: null,
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    metadata: {},
    ...over,
  };
}

function service(instances: ServiceInstance[]): ServiceDefinition {
  return {
    name: "users",
    prefix: "/users",
    instances,
    healthCheckPath: "/health",
    dynamic: false,
  };
}

describe("load-balancer", () => {
  beforeEach(() => resetLoadBalancerState());

  it("excludes unhealthy instances", () => {
    const svc = service([
      instance("a", { health: "unhealthy" }),
      instance("b"),
    ]);
    expect(eligibleInstances(svc).map((i) => i.id)).toEqual(["b"]);
  });

  it("falls back to the full pool when all instances are unhealthy", () => {
    const svc = service([
      instance("a", { health: "unhealthy" }),
      instance("b", { health: "unhealthy" }),
    ]);
    expect(eligibleInstances(svc)).toHaveLength(2);
  });

  it("round-robin cycles through instances", () => {
    const svc = service([instance("a"), instance("b"), instance("c")]);
    const picks = [0, 1, 2, 3].map(
      () => selectInstance(svc, "round-robin")!.id,
    );
    expect(picks).toEqual(["a", "b", "c", "a"]);
  });

  it("least-connections picks the least busy instance", () => {
    const svc = service([
      instance("a", { activeConnections: 5 }),
      instance("b", { activeConnections: 1 }),
      instance("c", { activeConnections: 9 }),
    ]);
    expect(selectInstance(svc, "least-connections")!.id).toBe("b");
  });

  it("weighted round-robin honours instance weight", () => {
    const svc = service([
      instance("a", { weight: 3 }),
      instance("b", { weight: 1 }),
    ]);
    const picks = [0, 1, 2, 3].map(
      () => selectInstance(svc, "weighted-round-robin")!.id,
    );
    expect(picks.filter((p) => p === "a")).toHaveLength(3);
    expect(picks.filter((p) => p === "b")).toHaveLength(1);
  });

  it("returns null for an empty pool", () => {
    expect(selectInstance(service([]), "round-robin")).toBeNull();
  });
});
