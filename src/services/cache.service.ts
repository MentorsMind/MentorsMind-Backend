import { trace, SpanStatusCode } from "@opentelemetry/api";
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
  for (const entry of Array.from(memStore.entries())) {
    const [key, entryValue] = entry;
    if (entryValue.expiresAt <= now) memStore.delete(key);
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
  return Array.from(memStore.keys()).filter((k) => regex.test(k));
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

// ─── OpenTelemetry Span Helper ────────────────────────────────────────────────

/**
 * Runs a cache backend operation inside an OpenTelemetry span named
 * `cache.<operation>` so Redis call latency and errors are visible in traces.
 * Uses @opentelemetry/api directly — when the SDK has not been initialised the
 * API returns no-op spans, so this stays cheap in test/dev environments.
 */
function withCacheSpan<T>(
  operation: string,
  key: string | undefined,
  backend: "redis" | "memory",
  fn: () => Promise<T>,
): Promise<T> {
  const tracer = trace.getTracer("mentorminds");
  return tracer.startActiveSpan(`cache.${operation}`, async (span) => {
    span.setAttribute("cache.operation", operation);
    span.setAttribute("cache.backend", backend);
    if (key !== undefined) span.setAttribute("cache.key", key);
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      span.end();
    }
  });
}

// ─── Public Service ───────────────────────────────────────────────────────────

export class CacheService {
  /** Get a cached value, returns null on miss */
  static async get<T>(key: string): Promise<T | null> {
    try {
      const client = await getClient();
      const raw = client
        ? await withCacheSpan("get", key, "redis", () => client.get(key))
        : memGet(key);
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
        await withCacheSpan("set", key, "redis", () =>
          client.setex(key, ttlSeconds, serialized),
        );
      } else {
        memSet(key, serialized, ttlSeconds);
      }
      track('sets', key);
    } catch (err: any) {
      track('errors', key);
      logger.warn('Cache set error', { key, error: err.message });
    }
  }


  /** Add members to a set */
  static async sadd(key: string, members: string[], ttlSeconds = redisConfig.defaultTtl): Promise<void> {
    try {
      if (members.length === 0) return;
      const client = await getClient();
      if (client) {
        await withCacheSpan("sadd", key, "redis", () => client.sadd(key, ...members));
        await withCacheSpan("expire", key, "redis", () => client.expire(key, ttlSeconds));
      } else {
        const current = new Set(JSON.parse(memGet(key) || '[]') as string[]);
        for (const m of members) current.add(m);
        memSet(key, JSON.stringify(Array.from(current)), ttlSeconds);
      }
      track('sets', key);
    } catch (err: any) {
      track('errors', key);
      logger.warn('Cache sadd error', { key, error: err.message });
    }
  }

  /** Check if member is in set */
  static async sismember(key: string, member: string): Promise<boolean> {
    try {
      const client = await getClient();
      if (client) {
        const res = await withCacheSpan("sismember", key, "redis", () => client.sismember(key, member));
        track('hits', key);
        return res === 1;
      } else {
        const current = JSON.parse(memGet(key) || '[]') as string[];
        track('hits', key);
        return current.includes(member);
      }
    } catch (err: any) {
      track('errors', key);
      logger.warn('Cache sismember error', { key, error: err.message });
      return false;
    }
  }

  /** Delete a specific key */
  static async del(key: string): Promise<void> {
    try {
      const client = await getClient();
      if (client) {
        await withCacheSpan("del", key, "redis", () => client.del(key));
      } else {
        memDel(key);
      }
      track('deletes', key);
    } catch (err: any) {
      track('errors', key);
      logger.warn('Cache del error', { key, error: err.message });
    }
  }

  /** Push a JSON value onto a capped Redis list, with in-memory fallback. */
  static async lpushTrim<T>(
    key: string,
    value: T,
    maxLength: number,
    ttlSeconds = redisConfig.defaultTtl,
  ): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      const client = await getClient();
      if (client) {
        await withCacheSpan("lpush", key, "redis", () => client.lpush(key, serialized));
        await withCacheSpan("ltrim", key, "redis", () =>
          client.ltrim(key, 0, maxLength - 1),
        );
        await withCacheSpan("expire", key, "redis", () =>
          client.expire(key, ttlSeconds),
        );
      } else {
        const current = JSON.parse(memGet(key) || '[]') as T[];
        current.unshift(value);
        memSet(key, JSON.stringify(current.slice(0, maxLength)), ttlSeconds);
      }
      track('sets', key);
    } catch (err: any) {
      track('errors', key);
      logger.warn('Cache list push error', { key, error: err.message });
    }
  }

  /** Read a JSON Redis list range, newest first for lists written by lpushTrim. */
  static async lrange<T>(key: string, start = 0, stop = -1): Promise<T[]> {
    try {
      const client = await getClient();
      const rawItems: string[] = client
        ? await withCacheSpan("lrange", key, "redis", () =>
            client.lrange(key, start, stop),
          )
        : (JSON.parse(memGet(key) || '[]') as T[])
            .slice(start, stop === -1 ? undefined : stop + 1)
            .map((item) => JSON.stringify(item));

      track(rawItems.length > 0 ? 'hits' : 'misses', key);
      return rawItems.map((raw) => JSON.parse(raw) as T);
    } catch (err: any) {
      track('errors', key);
      logger.warn('Cache list range error', { key, error: err.message });
      return [];
    }
  }

  /** Delete all keys matching a glob pattern (e.g. `mm:mentors:*`) */
  static async invalidatePattern(pattern: string): Promise<void> {
    try {
      const client = await getClient();
      if (client) {
        const keys: string[] = await withCacheSpan("keys", pattern, "redis", () =>
          client.keys(pattern),
        );
        if (keys.length) {
          await withCacheSpan("del", pattern, "redis", () => client.del(...keys));
        }
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

  /** Alias for invalidatePattern — backward compat */
  static invalidate = CacheService.invalidatePattern;

  /** Returns whether Redis is active */
  static isDistributed(): boolean {
    return redisAvailable;
  }

  /** Ping the shared Redis client. Throws if the ping fails. */
  static async ping(): Promise<void> {
    const client = await getClient();
    if (!client) throw new Error('Redis client unavailable');
    const pong = await withCacheSpan("ping", undefined, "redis", () => client.ping());
    if (pong !== 'PONG') throw new Error(`Unexpected ping response: ${pong}`);
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
