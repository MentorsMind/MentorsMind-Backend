import { env } from "./env";

/**
 * Monitoring and Metrics Configuration
 * Controls health checks, Prometheus metrics, and observability features.
 */
export interface MonitoringConfig {
  /** Prometheus metrics server config */
  prometheus: {
    enabled: boolean;
    port: number;
    endpoint: string;
  };
  /** Health check configuration */
  health: {
    /** Interval for background health checks (ms) */
    checkIntervalMs: number;
    /** Timeout for individual checks (ms) */
    timeoutMs: number;
  };
  /** Metrics collection flags */
  metrics: {
    trackRequests: boolean;
    trackDatabase: boolean;
    trackRedis: boolean;
    trackCache: boolean;
    trackStellar: boolean;
    /** Custom labels for metrics */
    labels: Record<string, string>;
  };
  /** Logging */
  logging: {
    structuredHealth: boolean;
    logHealthEvents: boolean;
  };
}

/**
 * Load monitoring configuration with sensible defaults.
 */
export const monitoringConfig: MonitoringConfig = {
  prometheus: {
    enabled:
      env.NODE_ENV === "development" || env.PROMETHEUS_ENABLED === "true",
    port: parseInt(env.PROMETHEUS_PORT, 10),
    endpoint: env.PROMETHEUS_ENDPOINT,
  },
  health: {
    checkIntervalMs: parseInt(env.HEALTH_CHECK_INTERVAL, 10), // 30s
    timeoutMs: parseInt(env.HEALTH_CHECK_TIMEOUT, 10), // 5s
  },
  metrics: {
    trackRequests: true,
    trackDatabase: true,
    trackRedis: true,
    trackCache: true,
    trackStellar: true,
    labels: {
      app: "mentorminds",
      version: env.API_VERSION,
      environment: env.NODE_ENV,
    },
  },
  logging: {
    structuredHealth: true,
    logHealthEvents: env.NODE_ENV === "development",
  },
};

// Validate critical config
if (
  monitoringConfig.prometheus.enabled &&
  isNaN(monitoringConfig.prometheus.port)
) {
  throw new Error(
    "PROMETHEUS_PORT must be a valid number when Prometheus is enabled",
  );
}

export default monitoringConfig;
