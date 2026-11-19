/**
 * API Gateway — shared types
 *
 * Central type definitions for the gateway: service definitions, upstream
 * instances, routing rules, load-balancing strategies and health state.
 */

/** Supported load-balancing strategies for spreading traffic across instances. */
export type LoadBalancingStrategy =
  | "round-robin"
  | "least-connections"
  | "random"
  | "weighted-round-robin";

/** Health state of a single upstream instance. */
export type InstanceHealth = "healthy" | "unhealthy" | "unknown";

/** Circuit-breaker state for an upstream service. */
export type CircuitState = "closed" | "open" | "half-open";

/** A single upstream instance backing a logical service. */
export interface ServiceInstance {
  /** Stable identifier for this instance (host:port by default). */
  id: string;
  /** Base URL of the instance, e.g. `http://users-svc-1:4001`. */
  url: string;
  /** Relative weight for weighted strategies (default 1). */
  weight: number;
  /** Current health as determined by the health checker. */
  health: InstanceHealth;
  /** Active in-flight request count (used by least-connections). */
  activeConnections: number;
  /** Epoch millis of the last completed health probe. */
  lastCheckedAt: number | null;
  /** Consecutive failed probes since the last success. */
  consecutiveFailures: number;
  /** Consecutive successful probes since the last failure. */
  consecutiveSuccesses: number;
  /** Free-form metadata supplied at registration time. */
  metadata: Record<string, string>;
}

/** A logical service that the gateway can route to. */
export interface ServiceDefinition {
  /** Logical name, referenced by routing rules (e.g. `users`). */
  name: string;
  /** Path prefix used for auto-discovery routing, e.g. `/users`. */
  prefix: string;
  /** Upstream instances backing the service. */
  instances: ServiceInstance[];
  /** Per-service load-balancing strategy (falls back to the gateway default). */
  strategy?: LoadBalancingStrategy;
  /** Relative path probed for health checks (default `/health`). */
  healthCheckPath: string;
  /** Whether the service was registered dynamically at runtime. */
  dynamic: boolean;
}

/** Input accepted when (de)registering a service instance at runtime. */
export interface RegisterInstanceInput {
  service: string;
  prefix?: string;
  url: string;
  weight?: number;
  healthCheckPath?: string;
  metadata?: Record<string, string>;
}

/** Result of a routing decision. */
export interface RouteResolution {
  service: ServiceDefinition;
  instance: ServiceInstance;
  /** Path on the upstream after stripping the gateway prefix. */
  upstreamPath: string;
}

/** Snapshot of rate-limiter state for a single key. */
export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Millis until the bucket refills enough for one more request. */
  retryAfterMs: number;
  resetAt: number;
}

/** Aggregated gateway statistics for the monitoring endpoint. */
export interface GatewayStats {
  uptimeSeconds: number;
  totalRequests: number;
  totalErrors: number;
  rateLimited: number;
  circuitTrips: number;
  services: Array<{
    name: string;
    prefix: string;
    strategy: LoadBalancingStrategy;
    circuit: CircuitState;
    instances: Array<{
      id: string;
      url: string;
      health: InstanceHealth;
      weight: number;
      activeConnections: number;
      consecutiveFailures: number;
      lastCheckedAt: number | null;
    }>;
  }>;
}
