import { logger } from '../utils/logger.utils';
import { redisConfig } from '../config/redis.config';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CacheMetrics {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  errors: number;
}

// ─── In-Memory Fallback ───────────────────────────────────────────────────────

interface MemEntry {
  value: string;
  expiresAt: number;
}
/**
 * Fallback cache store used when Redis is unavailable.
 * Limitation: if the process writes to memory during a Redis outage and Redis
 * later reconnects, old in-memory entries can remain until TTL expiry because
 * delete/invalidate operations route to the currently active backend.
 */
const memStore = new Map<string, MemEntry>();

// Evict expired entries every minute
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memStore.entries()) {
    if (entry.expiresAt <= now) memStore.delete(key);
  }
}, 60_000);

function memGet(key: string): string | null {
  const entry = memStore.get(key);
  if (!entry || entry.expiresAt <= Date.now()) {
    memStore.delete(key);
    return null;
  }
  return entry.value;
}

function memSet(key: string, value: string, ttlSeconds: number): void {
  memStore.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

function memDel(key: string): void {
  memStore.delete(key);
}

function memKeys(pattern: string): string[] {
  const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
  return [...memStore.keys()].filter((k) => regex.test(k));
}

// ─── Redis Client ─────────────────────────────────────────────────────────────

let redisClient: any = null;
let redisAvailable = false;

async function getClient(): Promise<any | null> {
  if (redisClient) return redisAvailable ? redisClient : null;
  if (!redisConfig.url) return null;

  try {
    const { default: Redis } = await import('ioredis');
    // Strip the mm: prefix from options — we manage prefixes in CacheKeys manually
    const { keyPrefix: _kp, ...opts } = redisConfig.options;
    redisClient = new Redis(redisConfig.url, opts);

    redisClient.on('connect', () => {
      redisAvailable = true;
      logger.info('Cache: Redis connected');
    });
    redisClient.on('error', (err: Error) => {
      if (redisAvailable)
        logger.warn('Cache: Redis lost — falling back to memory', {
          error: err.message,
        });
      redisAvailable = false;
    });

    await redisClient.connect();
    return redisClient;
  } catch (err: any) {
    logger.warn('Cache: Redis unavailable — using in-memory cache', {
      error: err.message,
    });
    return null;
  }
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

const metrics: CacheMetrics = {
  hits: 0,
  misses: 0,
  sets: 0,
  deletes: 0,
  errors: 0,
};

function track(event: keyof CacheMetrics, key: string): void {
  metrics[event]++;
  if (redisConfig.logMetrics) {
    logger.debug(`Cache ${event}`, { key });
  }
}

// ─── Public Service ───────────────────────────────────────────────────────────

export class CacheService {
  /** Get a cached value, returns null on miss */
  static async get<T>(key: string): Promise<T | null> {
    try {
      const client = await getClient();
      const raw = client ? await client.get(key) : memGet(key);
      if (raw === null) {
        track('misses', key);
        return null;
      }
      track('hits', key);
      return JSON.parse(raw) as T;
    } catch (err: any) {
      track('errors', key);
      logger.warn('Cache get error', { key, error: err.message });
      return null;
    }
  }

  /** Set a value with TTL in seconds */
  static async set<T>(
    key: string,
    value: T,
    ttlSeconds = redisConfig.defaultTtl,
  ): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      const client = await getClient();
      if (client) {
        await client.setex(key, ttlSeconds, serialized);
      } else {
        memSet(key, serialized, ttlSeconds);
      }
      track('sets', key);
    } catch (err: any) {
      track('errors', key);
      logger.warn('Cache set error', { key, error: err.message });
    }
  }

  /** Delete a specific key */
  static async del(key: string): Promise<void> {
    try {
      const client = await getClient();
      if (client) await client.del(key);
      else memDel(key);
      track('deletes', key);
    } catch (err: any) {
      track('errors', key);
      logger.warn('Cache del error', { key, error: err.message });
    }
  }

  /** Delete all keys matching a glob pattern (e.g. `mm:mentors:*`) */
  static async invalidatePattern(pattern: string): Promise<void> {
    try {
      const client = await getClient();
      if (client) {
        const keys: string[] = await client.keys(pattern);
        if (keys.length) await client.del(...keys);
      } else {
        for (const key of memKeys(pattern)) memDel(key);
      }
      logger.debug('Cache invalidated pattern', { pattern });
    } catch (err: any) {
      track('errors', pattern);
      logger.warn('Cache invalidatePattern error', {
        pattern,
        error: err.message,
      });
    }
  }

  /**
   * Cache-aside helper: returns cached value or calls `fn`, caches and returns its result.
   * @example
   * const user = await CacheService.wrap(CacheKeys.user(id), CacheTTL.medium, () => db.findUser(id));
   */
  static async wrap<T>(
    key: string,
    ttlSeconds: number,
    fn: () => Promise<T>,
  ): Promise<T> {
    const cached = await CacheService.get<T>(key);
    if (cached !== null) return cached;
    const value = await fn();
    await CacheService.set(key, value, ttlSeconds);
    return value;
  }

  /** Returns current hit/miss/error counters */
  static getMetrics(): CacheMetrics {
    return { ...metrics };
  }

  /** Returns whether Redis is active */
  static isDistributed(): boolean {
    return redisAvailable;
  }

  /** Warm the cache by pre-populating a set of key/value pairs */
  static async warm<T>(
    entries: Array<{ key: string; ttl: number; fn: () => Promise<T> }>,
  ): Promise<void> {
    await Promise.allSettled(
      entries.map(({ key, ttl, fn }) => CacheService.wrap(key, ttl, fn)),
    );
    logger.info('Cache warmed', { count: entries.length });
  }
}
