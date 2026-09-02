import { logger } from '../utils/logger.utils';
import { redis } from '../config/redis';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SlidingWindowResult {
  allowed: boolean;
  current: number;
  remaining: number;
  resetTime: Date;
  limit: number;
}

export type UserTier = 'free' | 'pro' | 'enterprise' | 'unknown';
export type EndpointCategory = 'auth' | 'payment' | 'file-upload' | 'general' | 'other';

export interface RateLimitOptions {
  category?: EndpointCategory;
  tier?: UserTier;
}

// ─── In-Memory Store (fallback when Redis is unavailable) ─────────────────────

interface WindowEntry {
  timestamps: number[];
  windowMs: number;
}

const memoryStore = new Map<string, WindowEntry>();

function slidingWindowMemory(key: string, windowMs: number, max: number): SlidingWindowResult {
  const now = Date.now();
  const windowStart = now - windowMs;

  let entry = memoryStore.get(key);
  if (!entry) {
    entry = { timestamps: [], windowMs };
    memoryStore.set(key, entry);
  }

  // Evict timestamps outside the window
  entry.timestamps = entry.timestamps.filter((t) => t > windowStart);
  entry.timestamps.push(now);

  const current = entry.timestamps.length;
  const allowed = current <= max;
  const oldest = entry.timestamps[0] ?? now;
  const resetTime = new Date(oldest + windowMs);

  return { allowed, current, remaining: Math.max(0, max - current), resetTime, limit: max };
}

// Periodically clean up stale keys to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const entry of Array.from(memoryStore.entries())) {
    const [key, entryValue] = entry;
    const windowStart = now - entryValue.windowMs;
    entryValue.timestamps = entryValue.timestamps.filter((t) => t > windowStart);
    if (entryValue.timestamps.length === 0) {
      memoryStore.delete(key);
    }
  }
}, 60_000);

// ─── Redis Store ──────────────────────────────────────────────────────────────

/**
 * Sliding window via Redis sorted sets.
 * Each member is a unique timestamp; score = timestamp (ms).
 */
async function slidingWindowRedis(
  key: string,
  windowMs: number,
  max: number
): Promise<SlidingWindowResult> {
  const now = Date.now();
  const windowStart = now - windowMs;
  const redisKey = `rl:sw:${key}`;

  const pipeline = redis.pipeline();
  pipeline.zremrangebyscore(redisKey, '-inf', windowStart);
  pipeline.zadd(redisKey, now, `${now}-${Math.random()}`);
  pipeline.zcard(redisKey);
  pipeline.zrange(redisKey, 0, 0, 'WITHSCORES');
  pipeline.pexpire(redisKey, windowMs);

  const results = await pipeline.exec();
  const current: number = results![2][1] as number;
  const oldestScore: number = results![3][1]?.[1]
    ? parseInt(results![3][1][1], 10)
    : now;

  const allowed = current <= max;
  const resetTime = new Date(oldestScore + windowMs);

  return { allowed, current, remaining: Math.max(0, max - current), resetTime, limit: max };
}

// ─── Tier Limits ──────────────────────────────────────────────────────────────

const TIER_LIMITS: Record<UserTier, { max: number; windowMs: number }> = {
  free: { max: 60, windowMs: 60 * 1000 }, // 60 req/min
  pro: { max: 200, windowMs: 60 * 1000 }, // 200 req/min
  enterprise: { max: Infinity, windowMs: 60 * 1000 }, // unlimited
  unknown: { max: 60, windowMs: 60 * 1000 },
};

// ─── Endpoint Category Limits ─────────────────────────────────────────────────

const CATEGORY_LIMITS: Record<EndpointCategory, { max: number; windowMs: number }> = {
  auth: { max: 10, windowMs: 15 * 60 * 1000 }, // 10 req/15min
  payment: { max: 20, windowMs: 60 * 1000 }, // 20 req/min
  'file-upload': { max: 5, windowMs: 60 * 1000 }, //5 req/min
  general: { max: 60, windowMs: 60 * 1000 },
  other: { max: 60, windowMs: 60 * 1000 },
};

// ─── Public API ───────────────────────────────────────────────────────────────

export class RateLimiterService {
  /**
   * Check and record a hit for the given key using a sliding window.
   * Uses Redis, falls back to in-memory if Redis fails.
   */
  static async check(key: string, windowMs: number, max: number): Promise<SlidingWindowResult> {
    try {
      return await slidingWindowRedis(key, windowMs, max);
    } catch (err: any) {
      logger.warn('Redis sliding window error — falling back to memory', { error: err.message });
      return slidingWindowMemory(key, windowMs, max);
    }
  }

  static getTierLimit(tier: UserTier): { max: number; windowMs: number } {
    return TIER_LIMITS[tier] || TIER_LIMITS.free;
  }

  static getCategoryLimit(category: EndpointCategory): { max: number; windowMs: number } {
    return CATEGORY_LIMITS[category] || CATEGORY_LIMITS.general;
  }

  /**
   * Reset all hits for a key (e.g. after successful login).
   */
  static async reset(key: string): Promise<void> {
    memoryStore.delete(key);
    try {
      await redis.del(`rl:sw:${key}`);
    } catch {
      // best-effort
    }
  }

  /**
   * Returns whether Redis is currently being used.
   */
  static isDistributed(): boolean {
    return true;
  }

  /**
   * Analytics: get current hit count for a key without recording a new hit.
   */
  static async getCount(key: string, windowMs: number): Promise<number> {
    try {
      const now = Date.now();
      const windowStart = now - windowMs;
      return await redis.zcount(`rl:sw:${key}`, windowStart, '+inf');
    } catch {
      const entry = memoryStore.get(key);
      if (!entry) return 0;
      const windowStart = Date.now() - windowMs;
      return entry.timestamps.filter((t) => t > windowStart).length;
    }
  }
}
