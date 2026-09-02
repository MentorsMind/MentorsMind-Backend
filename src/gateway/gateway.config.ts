/**
 * API Gateway configuration
 *
 * Reads gateway tunables from the environment with safe defaults so the module
 * stays inert (disabled) unless explicitly switched on via `GATEWAY_ENABLED`.
 *
 * A static service catalogue can be provided through `GATEWAY_SERVICES` as a
 * JSON array, e.g.:
 *   GATEWAY_SERVICES='[{"name":"users","prefix":"/users","instances":["http://users-1:4001","http://users-2:4001"]}]'
 */

import type { LoadBalancingStrategy, ServiceDefinition } from "./types";
import { logger } from "../utils/logger";

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === "true" || value === "1";
}

const VALID_STRATEGIES: LoadBalancingStrategy[] = [
  "round-robin",
  "least-connections",
  "random",
  "weighted-round-robin",
];

function strategy(
  value: string | undefined,
  fallback: LoadBalancingStrategy,
): LoadBalancingStrategy {
  return VALID_STRATEGIES.includes(value as LoadBalancingStrategy)
    ? (value as LoadBalancingStrategy)
    : fallback;
}

export interface GatewayConfig {
  /** Master switch — when false the gateway middleware/routes are no-ops. */
  enabled: boolean;
  /** Default load-balancing strategy applied to services with no override. */
  defaultStrategy: LoadBalancingStrategy;
  /** Upstream request timeout in millis. */
  proxyTimeoutMs: number;
  /** Retry a failed idempotent upstream call against another instance N times. */
  proxyRetries: number;
  rateLimit: {
    enabled: boolean;
    /** Sustained requests per window per client key. */
    requestsPerWindow: number;
    /** Sliding window size in millis. */
    windowMs: number;
    /** Extra burst capacity on top of the sustained rate. */
    burst: number;
  };
  healthCheck: {
    enabled: boolean;
    intervalMs: number;
    timeoutMs: number;
    /** Failed probes before an instance is marked unhealthy. */
    unhealthyThreshold: number;
    /** Successful probes before an instance is marked healthy again. */
    healthyThreshold: number;
  };
  circuitBreaker: {
    enabled: boolean;
    /** Consecutive upstream failures before the circuit opens. */
    failureThreshold: number;
    /** Cooldown before a tripped circuit moves to half-open. */
    resetTimeoutMs: number;
  };
  /** Services declared statically via env. Dynamic ones are added at runtime. */
  staticServices: ServiceDefinition[];
}

function parseStaticServices(raw: string | undefined): ServiceDefinition[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Array<{
      name: string;
      prefix?: string;
      instances: string[];
      strategy?: string;
      healthCheckPath?: string;
    }>;

    if (!Array.isArray(parsed)) throw new Error("expected a JSON array");

    return parsed.map((svc) => {
      if (!svc.name || !Array.isArray(svc.instances)) {
        throw new Error(`invalid service entry: ${JSON.stringify(svc)}`);
      }
      const prefix = svc.prefix || `/${svc.name}`;
      return {
        name: svc.name,
        prefix: prefix.startsWith("/") ? prefix : `/${prefix}`,
        strategy: VALID_STRATEGIES.includes(svc.strategy as LoadBalancingStrategy)
          ? (svc.strategy as LoadBalancingStrategy)
          : undefined,
        healthCheckPath: svc.healthCheckPath || "/health",
        dynamic: false,
        instances: svc.instances.map((url) => ({
          id: url.replace(/^https?:\/\//, ""),
          url: url.replace(/\/$/, ""),
          weight: 1,
          health: "unknown" as const,
          activeConnections: 0,
          lastCheckedAt: null,
          consecutiveFailures: 0,
          consecutiveSuccesses: 0,
          metadata: {},
        })),
      };
    });
  } catch (err) {
    logger.error("Failed to parse GATEWAY_SERVICES; ignoring", {
      error: (err as Error).message,
    });
    return [];
  }
}

const gatewayConfig: GatewayConfig = {
  enabled: bool(process.env.GATEWAY_ENABLED, false),
  defaultStrategy: strategy(process.env.GATEWAY_LB_STRATEGY, "round-robin"),
  proxyTimeoutMs: num(process.env.GATEWAY_PROXY_TIMEOUT_MS, 15000),
  proxyRetries: num(process.env.GATEWAY_PROXY_RETRIES, 1),
  rateLimit: {
    enabled: bool(process.env.GATEWAY_RATE_LIMIT_ENABLED, true),
    requestsPerWindow: num(process.env.GATEWAY_RATE_LIMIT_MAX, 120),
    windowMs: num(process.env.GATEWAY_RATE_LIMIT_WINDOW_MS, 60000),
    burst: num(process.env.GATEWAY_RATE_LIMIT_BURST, 40),
  },
  healthCheck: {
    enabled: bool(process.env.GATEWAY_HEALTH_CHECK_ENABLED, true),
    intervalMs: num(process.env.GATEWAY_HEALTH_CHECK_INTERVAL_MS, 15000),
    timeoutMs: num(process.env.GATEWAY_HEALTH_CHECK_TIMEOUT_MS, 3000),
    unhealthyThreshold: num(process.env.GATEWAY_HEALTH_UNHEALTHY_THRESHOLD, 3),
    healthyThreshold: num(process.env.GATEWAY_HEALTH_HEALTHY_THRESHOLD, 2),
  },
  circuitBreaker: {
    enabled: bool(process.env.GATEWAY_CIRCUIT_BREAKER_ENABLED, true),
    failureThreshold: num(process.env.GATEWAY_CIRCUIT_FAILURE_THRESHOLD, 5),
    resetTimeoutMs: num(process.env.GATEWAY_CIRCUIT_RESET_TIMEOUT_MS, 30000),
  },
  staticServices: parseStaticServices(process.env.GATEWAY_SERVICES),
};

export default gatewayConfig;
