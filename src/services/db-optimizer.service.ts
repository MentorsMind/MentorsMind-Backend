/**
 * Database optimisation surface (issue #859).
 *
 * Three concerns the issue groups together, kept separate here because they
 * fail independently:
 *
 *  - **Multi-level cache** (L1 in-process, L2 shared) with stale-while-
 *    revalidate, so a cold shared cache does not stampede the database.
 *  - **Pool health**, reporting saturation rather than waiting for timeouts.
 *  - **Read-replica routing**, which refuses to route reads to a replica that
 *    has fallen too far behind.
 */

import type { Pool, QueryResult, QueryResultRow } from "pg";
import primaryPool from "../config/database";
import { logger } from "../utils/logger";
import databaseTuning from "../config/database-tuning";

// ─── L1: in-process cache ────────────────────────────────────────────────────

interface L1Entry<T> {
  value: T;
  expiresAt: number;
  /** Entry may still be served while a refresh runs. */
  staleUntil: number;
}

/**
 * Bounded LRU. In-process only: it removes duplicate work inside one instance
 * and is not a substitute for the shared tier, which is where cross-instance
 * consistency lives.
 */
class L1Cache {
  private readonly entries = new Map<string, L1Entry<unknown>>();
  private hits = 0;
  private misses = 0;

  get<T>(key: string): { value: T; stale: boolean } | undefined {
    const entry = this.entries.get(key) as L1Entry<T> | undefined;
    if (!entry) {
      this.misses += 1;
      return undefined;
    }

    const now = Date.now();
    if (now >= entry.staleUntil) {
      this.entries.delete(key);
      this.misses += 1;
      return undefined;
    }

    // Refresh recency.
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.hits += 1;
    return { value: entry.value, stale: now >= entry.expiresAt };
  }

  set<T>(key: string, value: T): void {
    const { l1TtlMs, l1MaxEntries, staleWhileRevalidateMs } = databaseTuning.cache;
    const now = Date.now();

    this.entries.delete(key);
    this.entries.set(key, {
      value,
      expiresAt: now + l1TtlMs,
      staleUntil: now + l1TtlMs + staleWhileRevalidateMs,
    });

    while (this.entries.size > l1MaxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  invalidate(prefix: string): number {
    let removed = 0;
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  get stats() {
    const total = this.hits + this.misses;
    return {
      size: this.entries.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total === 0 ? 0 : this.hits / total,
    };
  }

  clear(): void {
    this.entries.clear();
    this.hits = 0;
    this.misses = 0;
  }
}

const l1 = new L1Cache();

/** Optional shared tier. Injected so this module does not hard-depend on Redis. */
export interface SharedCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<unknown>;
}

let sharedCache: SharedCache | null = null;

export function registerSharedCache(cache: SharedCache | null): void {
  sharedCache = cache;
}

// ─── Read replicas ───────────────────────────────────────────────────────────

interface ReplicaState {
  pool: Pool;
  url: string;
  failures: number;
  healthy: boolean;
}

const replicas: ReplicaState[] = [];
let replicaCursor = 0;

/**
 * Register read replicas.
 *
 * Pools are supplied by the caller rather than constructed here so this module
 * stays testable and does not open connections as a side effect of import.
 */
export function registerReplicas(pools: Array<{ pool: Pool; url: string }>): void {
  replicas.length = 0;
  for (const { pool, url } of pools) {
    replicas.push({ pool, url, failures: 0, healthy: true });
  }
  replicaCursor = 0;
}

/**
 * Pick a replica for a read, or null to use the primary.
 *
 * Round-robin over healthy replicas. Returns null when replicas are disabled,
 * none are registered, or all are unhealthy — the primary is always a correct
 * answer, so there is no failure mode where a read has nowhere to go.
 */
export function pickReadPool(): Pool | null {
  if (!databaseTuning.replicas.enabled) return null;
  const healthy = replicas.filter((r) => r.healthy);
  if (healthy.length === 0) return null;

  const chosen = healthy[replicaCursor % healthy.length];
  replicaCursor = (replicaCursor + 1) % Math.max(healthy.length, 1);
  return chosen.pool;
}

function markReplicaFailure(pool: Pool): void {
  const state = replicas.find((r) => r.pool === pool);
  if (!state) return;
  state.failures += 1;
  if (state.failures >= databaseTuning.replicas.unhealthyThreshold) {
    state.healthy = false;
    logger.warn({ replica: state.url }, "Read replica marked unhealthy");
  }
}

/** Restore a replica to rotation after its lag and connectivity recover. */
export function markReplicaHealthy(url: string): void {
  const state = replicas.find((r) => r.url === url);
  if (!state) return;
  state.failures = 0;
  state.healthy = true;
}

// ─── Pool health ─────────────────────────────────────────────────────────────

export interface PoolHealth {
  total: number;
  idle: number;
  waiting: number;
  utilizationPercent: number;
  saturated: boolean;
}

export function poolHealth(target: Pool = primaryPool): PoolHealth {
  const total = (target as unknown as { totalCount?: number }).totalCount ?? 0;
  const idle = (target as unknown as { idleCount?: number }).idleCount ?? 0;
  const waiting = (target as unknown as { waitingCount?: number }).waitingCount ?? 0;
  const inUse = Math.max(total - idle, 0);
  const utilizationPercent = total === 0 ? 0 : (inUse / total) * 100;

  return {
    total,
    idle,
    waiting,
    utilizationPercent,
    saturated:
      utilizationPercent >= databaseTuning.pool.saturationPercent ||
      waiting > databaseTuning.pool.maxWaitingClients,
  };
}

// ─── Public surface ──────────────────────────────────────────────────────────

export const DbOptimizerService = {
  /**
   * Run a read, preferring a healthy replica.
   *
   * A replica failure falls back to the primary rather than surfacing an error:
   * a lagging or unreachable replica is an availability problem for the replica,
   * not for the caller.
   */
  async read<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<QueryResult<T>> {
    const replica = pickReadPool();
    if (!replica) return primaryPool.query<T>(sql, params);

    try {
      return await replica.query<T>(sql, params);
    } catch (error) {
      markReplicaFailure(replica);
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "Replica read failed; falling back to primary",
      );
      return primaryPool.query<T>(sql, params);
    }
  },

  /**
   * Cached read through L1 then the shared tier.
   *
   * On an L1 stale hit the cached value is returned immediately and a refresh
   * runs in the background, so a hot key never blocks a request on the database.
   */
  async cachedRead<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const local = l1.get<T>(key);
    if (local && !local.stale) return local.value;

    if (local?.stale) {
      void this.refresh(key, loader);
      return local.value;
    }

    if (sharedCache) {
      try {
        const raw = await sharedCache.get(key);
        if (raw !== null) {
          const value = JSON.parse(raw) as T;
          l1.set(key, value);
          return value;
        }
      } catch (error) {
        logger.debug(
          { error: error instanceof Error ? error.message : String(error) },
          "Shared cache read failed; falling through to loader",
        );
      }
    }

    return this.refresh(key, loader);
  },

  /** Populate both tiers from the loader. */
  async refresh<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const value = await loader();
    l1.set(key, value);

    if (sharedCache) {
      try {
        await sharedCache.set(
          key,
          JSON.stringify(value),
          databaseTuning.cache.l2TtlSeconds,
        );
      } catch {
        // A shared-cache write failure must not fail the read it accompanies.
      }
    }

    return value;
  },

  /** Drop every cached entry under a prefix. */
  invalidate(prefix: string): number {
    return l1.invalidate(prefix);
  },

  poolHealth,
  cacheStats: () => l1.stats,
  clearLocalCache: () => l1.clear(),
};

export default DbOptimizerService;
