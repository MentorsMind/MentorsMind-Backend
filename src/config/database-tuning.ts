/**
 * Database tuning parameters (issue #859).
 *
 * Every threshold the optimizer and analyzer act on lives here rather than
 * inline at each call site, so tuning a production instance is a config change
 * and not a code change. Values are read from the environment with documented
 * defaults.
 */

const num = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const bool = (name: string, fallback: boolean): boolean => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw === "true" || raw === "1";
};

export interface QueryTuning {
  /** A query slower than this is a candidate for analysis. */
  slowQueryMs: number;
  /** A query slower than this is reported regardless of sampling. */
  criticalQueryMs: number;
  /** Fraction of qualifying queries actually analysed, to bound overhead. */
  analysisSampleRate: number;
  /** Never hold more than this many fingerprints in memory. */
  maxTrackedFingerprints: number;
}

export interface CacheTuning {
  /** In-process L1 entry lifetime. */
  l1TtlMs: number;
  /** Maximum L1 entries before least-recently-used eviction. */
  l1MaxEntries: number;
  /** Shared L2 (Redis) entry lifetime. */
  l2TtlSeconds: number;
  /** Serve a stale entry for this long while a refresh runs. */
  staleWhileRevalidateMs: number;
}

export interface PoolTuning {
  /** Utilisation percentage above which the pool is considered saturated. */
  saturationPercent: number;
  /** Waiting clients above which the pool is considered saturated. */
  maxWaitingClients: number;
  /** How often pool health is sampled. */
  sampleIntervalMs: number;
}

export interface ReplicaTuning {
  enabled: boolean;
  /** Connection strings for read replicas, comma separated. */
  urls: string[];
  /**
   * Replica lag above which a replica is skipped.
   *
   * Reads are only safe to route away from the primary while the replica is
   * fresh enough for the caller's expectations; past this the router falls
   * back to the primary rather than serving stale rows.
   */
  maxLagMs: number;
  /** Consecutive failures before a replica is taken out of rotation. */
  unhealthyThreshold: number;
}

export interface DatabaseTuning {
  query: QueryTuning;
  cache: CacheTuning;
  pool: PoolTuning;
  replicas: ReplicaTuning;
}

export const databaseTuning: DatabaseTuning = {
  query: {
    slowQueryMs: num("DB_SLOW_QUERY_MS", 500),
    criticalQueryMs: num("DB_CRITICAL_QUERY_MS", 2000),
    analysisSampleRate: Math.min(num("DB_ANALYSIS_SAMPLE_RATE", 0.1), 1),
    maxTrackedFingerprints: num("DB_MAX_TRACKED_FINGERPRINTS", 500),
  },
  cache: {
    l1TtlMs: num("CACHE_L1_TTL_MS", 30_000),
    l1MaxEntries: num("CACHE_L1_MAX_ENTRIES", 1000),
    l2TtlSeconds: num("CACHE_L2_TTL_SECONDS", 300),
    staleWhileRevalidateMs: num("CACHE_SWR_MS", 60_000),
  },
  pool: {
    saturationPercent: num("DB_POOL_SATURATION_PERCENT", 85),
    maxWaitingClients: num("DB_POOL_MAX_WAITING", 5),
    sampleIntervalMs: num("DB_POOL_SAMPLE_INTERVAL_MS", 15_000),
  },
  replicas: {
    enabled: bool("DB_READ_REPLICAS_ENABLED", false),
    urls: (process.env.DB_READ_REPLICA_URLS ?? "")
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean),
    maxLagMs: num("DB_REPLICA_MAX_LAG_MS", 5000),
    unhealthyThreshold: num("DB_REPLICA_UNHEALTHY_THRESHOLD", 3),
  },
};

export default databaseTuning;
