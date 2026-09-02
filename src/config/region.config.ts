/**
 * Multi-Region Configuration Module
 *
 * Manages global region deployment configuration with support for:
 * - Region identification and latency optimization
 * - Database replica management per region
 * - Failover strategies and health checks
 * - Data replication policies
 * - Load balancing and traffic routing
 */

import { env } from "./env";

// ---------------------------------------------------------------------------
// Types and Interfaces
// ---------------------------------------------------------------------------

export interface RegionConfig {
  /** Unique region identifier (e.g., 'us-east-1', 'eu-west-1') */
  id: string;
  /** Human-readable region name */
  name: string;
  /** Geographic location for latency calculation */
  location: {
    latitude: number;
    longitude: number;
    continent: "NA" | "SA" | "EU" | "AF" | "AS" | "OC";
  };
  /** Is this the primary region for writes */
  isPrimary: boolean;
  /** Is this region active and accepting traffic */
  isActive: boolean;
  /** Database configuration for this region */
  database: {
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
    /** Connection pool size per region */
    poolSize: number;
    /** Replica read replicas configuration */
    replicas: Array<{
      host: string;
      port: number;
      priority: number; // 1 = highest priority
      lagThresholdMs: number; // acceptable replication lag
    }>;
    /** Enable SSL/TLS for connections */
    ssl: boolean;
  };
  /** Health check configuration */
  healthCheck: {
    /** Interval between health checks (ms) */
    intervalMs: number;
    /** Health check timeout (ms) */
    timeoutMs: number;
    /** Number of consecutive failures before marking unhealthy */
    unhealthyThreshold: number;
    /** Number of consecutive successes before marking healthy */
    healthyThreshold: number;
    /** Health check endpoint path */
    endpoint: string;
  };
  /** Failover configuration */
  failover: {
    /** Secondary regions for failover (ordered by preference) */
    secondaryRegions: string[];
    /** Automatically trigger failover if primary unhealthy */
    automatic: boolean;
    /** Grace period before failover (ms) */
    gracePeriodMs: number;
  };
  /** Replication configuration */
  replication: {
    /** Strategy: 'async' | 'sync' | 'semi-sync' */
    strategy: "async" | "sync" | "semi-sync";
    /** Target lag time for semi-sync (ms) */
    targetLagMs: number;
    /** Binary log retention (days) */
    binlogRetentionDays: number;
    /** Exclude certain tables from replication */
    excludedTables?: string[];
  };
  /** Caching configuration */
  cache: {
    host: string;
    port: number;
    /** Redis Cluster enabled for this region */
    clusterEnabled: boolean;
    /** Cache eviction policy */
    evictionPolicy: "lru" | "lfu" | "allkeys-lru" | "allkeys-lfu";
    /** Maximum cache memory (MB) */
    maxMemoryMb: number;
  };
  /** Traffic routing weights */
  routing: {
    /** Percentage of traffic routed to this region (0-100) */
    trafficWeight: number;
    /** Enable sticky sessions */
    stickySession: boolean;
    /** Session affinity timeout (ms) */
    affinityTimeoutMs: number;
  };
  /** Messaging and queue configuration */
  messaging: {
    brokerHost: string;
    brokerPort: number;
    /** Topic replication factor across brokers in region */
    replicationFactor: number;
  };
}

export interface MultiRegionConfig {
  /** Enabled multi-region deployment */
  enabled: boolean;
  /** Primary region for writes */
  primaryRegion: string;
  /** All configured regions */
  regions: Record<string, RegionConfig>;
  /** Active regions for traffic routing */
  activeRegions: string[];
  /** Global replication policy */
  replication: {
    /** Enable cross-region replication */
    enabled: boolean;
    /** Maximum acceptable replication lag globally (ms) */
    maxLagMs: number;
    /** Retry policy for failed replication */
    retryPolicy: {
      maxAttempts: number;
      backoffMs: number;
      maxBackoffMs: number;
    };
  };
  /** Global failover settings */
  failover: {
    /** Enable automatic failover */
    automaticFailover: boolean;
    /** Check region health every N ms */
    healthCheckIntervalMs: number;
    /** Override to specific region (for testing) */
    overrideRegion?: string;
  };
  /** Global circuit breaker for region operations */
  circuitBreaker: {
    enabled: boolean;
    /** Failure threshold before opening circuit */
    failureThreshold: number;
    /** Time to wait before attempting half-open (ms) */
    resetTimeoutMs: number;
  };
}

// ---------------------------------------------------------------------------
// Default Region Configurations
// ---------------------------------------------------------------------------

const DEFAULT_REGIONS: Record<string, RegionConfig> = {
  "us-east-1": {
    id: "us-east-1",
    name: "US East (N. Virginia)",
    location: {
      latitude: 38.95,
      longitude: -77.47,
      continent: "NA",
    },
    isPrimary: true,
    isActive: true,
    database: {
      host: env.REGION_US_EAST_1_DB_HOST || "db-us-east-1.local",
      port: parseInt(env.REGION_US_EAST_1_DB_PORT || "5432", 10),
      name: env.DB_NAME,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      poolSize: parseInt(env.REGION_US_EAST_1_POOL_SIZE || "20", 10),
      replicas: [
        {
          host: env.REGION_US_EAST_1_REPLICA_1_HOST || "db-us-east-1-r1.local",
          port: 5432,
          priority: 1,
          lagThresholdMs: 1000,
        },
      ],
      ssl: env.DB_SSL === "true",
    },
    healthCheck: {
      intervalMs: 10000,
      timeoutMs: 5000,
      unhealthyThreshold: 3,
      healthyThreshold: 2,
      endpoint: "/health/region/us-east-1",
    },
    failover: {
      secondaryRegions: ["us-west-2", "eu-west-1"],
      automatic: true,
      gracePeriodMs: 30000,
    },
    replication: {
      strategy: "semi-sync",
      targetLagMs: 500,
      binlogRetentionDays: 7,
    },
    cache: {
      host: env.REGION_US_EAST_1_CACHE_HOST || "redis-us-east-1.local",
      port: 6379,
      clusterEnabled: false,
      evictionPolicy: "allkeys-lru",
      maxMemoryMb: 2048,
    },
    routing: {
      trafficWeight: 50,
      stickySession: true,
      affinityTimeoutMs: 300000,
    },
    messaging: {
      brokerHost: env.REGION_US_EAST_1_BROKER_HOST || "kafka-us-east-1.local",
      brokerPort: 9092,
      replicationFactor: 2,
    },
  },
  "eu-west-1": {
    id: "eu-west-1",
    name: "EU (Ireland)",
    location: {
      latitude: 53.4129,
      longitude: -8.2439,
      continent: "EU",
    },
    isPrimary: false,
    isActive: true,
    database: {
      host: env.REGION_EU_WEST_1_DB_HOST || "db-eu-west-1.local",
      port: parseInt(env.REGION_EU_WEST_1_DB_PORT || "5432", 10),
      name: env.DB_NAME,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      poolSize: parseInt(env.REGION_EU_WEST_1_POOL_SIZE || "20", 10),
      replicas: [
        {
          host: env.REGION_EU_WEST_1_REPLICA_1_HOST || "db-eu-west-1-r1.local",
          port: 5432,
          priority: 1,
          lagThresholdMs: 1000,
        },
      ],
      ssl: env.DB_SSL === "true",
    },
    healthCheck: {
      intervalMs: 10000,
      timeoutMs: 5000,
      unhealthyThreshold: 3,
      healthyThreshold: 2,
      endpoint: "/health/region/eu-west-1",
    },
    failover: {
      secondaryRegions: ["eu-central-1", "us-east-1"],
      automatic: true,
      gracePeriodMs: 30000,
    },
    replication: {
      strategy: "semi-sync",
      targetLagMs: 500,
      binlogRetentionDays: 7,
    },
    cache: {
      host: env.REGION_EU_WEST_1_CACHE_HOST || "redis-eu-west-1.local",
      port: 6379,
      clusterEnabled: false,
      evictionPolicy: "allkeys-lru",
      maxMemoryMb: 2048,
    },
    routing: {
      trafficWeight: 35,
      stickySession: true,
      affinityTimeoutMs: 300000,
    },
    messaging: {
      brokerHost: env.REGION_EU_WEST_1_BROKER_HOST || "kafka-eu-west-1.local",
      brokerPort: 9092,
      replicationFactor: 2,
    },
  },
  "ap-southeast-1": {
    id: "ap-southeast-1",
    name: "Asia Pacific (Singapore)",
    location: {
      latitude: 1.3521,
      longitude: 103.8198,
      continent: "AS",
    },
    isPrimary: false,
    isActive: true,
    database: {
      host: env.REGION_AP_SOUTHEAST_1_DB_HOST || "db-ap-southeast-1.local",
      port: parseInt(env.REGION_AP_SOUTHEAST_1_DB_PORT || "5432", 10),
      name: env.DB_NAME,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      poolSize: parseInt(env.REGION_AP_SOUTHEAST_1_POOL_SIZE || "20", 10),
      replicas: [
        {
          host: env.REGION_AP_SOUTHEAST_1_REPLICA_1_HOST || "db-ap-southeast-1-r1.local",
          port: 5432,
          priority: 1,
          lagThresholdMs: 1000,
        },
      ],
      ssl: env.DB_SSL === "true",
    },
    healthCheck: {
      intervalMs: 10000,
      timeoutMs: 5000,
      unhealthyThreshold: 3,
      healthyThreshold: 2,
      endpoint: "/health/region/ap-southeast-1",
    },
    failover: {
      secondaryRegions: ["ap-northeast-1", "us-east-1"],
      automatic: true,
      gracePeriodMs: 30000,
    },
    replication: {
      strategy: "semi-sync",
      targetLagMs: 500,
      binlogRetentionDays: 7,
    },
    cache: {
      host: env.REGION_AP_SOUTHEAST_1_CACHE_HOST || "redis-ap-southeast-1.local",
      port: 6379,
      clusterEnabled: false,
      evictionPolicy: "allkeys-lru",
      maxMemoryMb: 2048,
    },
    routing: {
      trafficWeight: 15,
      stickySession: true,
      affinityTimeoutMs: 300000,
    },
    messaging: {
      brokerHost: env.REGION_AP_SOUTHEAST_1_BROKER_HOST || "kafka-ap-southeast-1.local",
      brokerPort: 9092,
      replicationFactor: 2,
    },
  },
};

// ---------------------------------------------------------------------------
// Configuration Export
// ---------------------------------------------------------------------------

const regionConfig: MultiRegionConfig = {
  enabled: env.MULTI_REGION_ENABLED === "true",
  primaryRegion: env.PRIMARY_REGION || "us-east-1",
  regions: DEFAULT_REGIONS,
  activeRegions: (env.ACTIVE_REGIONS || "us-east-1,eu-west-1,ap-southeast-1")
    .split(",")
    .map((r) => r.trim()),
  replication: {
    enabled: env.REPLICATION_ENABLED === "true",
    maxLagMs: parseInt(env.REPLICATION_MAX_LAG_MS || "5000", 10),
    retryPolicy: {
      maxAttempts: parseInt(env.REPLICATION_RETRY_MAX_ATTEMPTS || "3", 10),
      backoffMs: parseInt(env.REPLICATION_RETRY_BACKOFF_MS || "1000", 10),
      maxBackoffMs: parseInt(env.REPLICATION_RETRY_MAX_BACKOFF_MS || "30000", 10),
    },
  },
  failover: {
    automaticFailover: env.AUTOMATIC_FAILOVER === "true",
    healthCheckIntervalMs: parseInt(env.HEALTH_CHECK_INTERVAL_MS || "10000", 10),
    overrideRegion: env.OVERRIDE_REGION,
  },
  circuitBreaker: {
    enabled: env.CIRCUIT_BREAKER_ENABLED === "true",
    failureThreshold: parseInt(env.CIRCUIT_BREAKER_FAILURE_THRESHOLD || "5", 10),
    resetTimeoutMs: parseInt(env.CIRCUIT_BREAKER_RESET_TIMEOUT_MS || "60000", 10),
  },
};

export default regionConfig;

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

/**
 * Get configuration for a specific region
 */
export function getRegionConfig(regionId: string): RegionConfig | null {
  return regionConfig.regions[regionId] || null;
}

/**
 * Get the primary region configuration
 */
export function getPrimaryRegionConfig(): RegionConfig {
  const primary = regionConfig.regions[regionConfig.primaryRegion];
  if (!primary) {
    throw new Error(
      `Primary region '${regionConfig.primaryRegion}' not found in configuration`
    );
  }
  return primary;
}

/**
 * Get all active region configurations
 */
export function getActiveRegionConfigs(): RegionConfig[] {
  return regionConfig.activeRegions
    .map((id) => regionConfig.regions[id])
    .filter((r): r is RegionConfig => !!r);
}

/**
 * Calculate latency-based routing weights
 * Returns normalized traffic weights for round-robin load balancing
 */
export function getLatencyBasedWeights(
  userLatencyByRegion: Record<string, number>
): Record<string, number> {
  const weights: Record<string, number> = {};
  const activeConfigs = getActiveRegionConfigs();

  // Inverse weighting: lower latency = higher traffic
  let totalWeight = 0;
  for (const config of activeConfigs) {
    const latency = userLatencyByRegion[config.id] || 50; // default 50ms
    const weight = 1 / (latency / 10); // normalize to reasonable range
    weights[config.id] = weight;
    totalWeight += weight;
  }

  // Normalize to percentages
  Object.keys(weights).forEach((key) => {
    weights[key] = (weights[key] / totalWeight) * 100;
  });

  return weights;
}

/**
 * Find the closest region based on coordinates
 */
export function findClosestRegion(
  latitude: number,
  longitude: number
): RegionConfig {
  const activeConfigs = getActiveRegionConfigs();

  // Haversine distance calculation
  function distance(lat1: number, lon1: number, lat2: number, lon2: number) {
    const R = 6371; // Earth's radius in km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  let closest = activeConfigs[0];
  let minDistance = Infinity;

  for (const config of activeConfigs) {
    const d = distance(
      latitude,
      longitude,
      config.location.latitude,
      config.location.longitude
    );
    if (d < minDistance) {
      minDistance = d;
      closest = config;
    }
  }

  return closest;
}

export type { RegionConfig, MultiRegionConfig };
