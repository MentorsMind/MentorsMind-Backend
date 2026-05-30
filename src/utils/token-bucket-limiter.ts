/**
 * Token Bucket Rate Limiter
 *
 * Supports:
 * - Token bucket algorithm with burst capacity
 * - Sliding window fallback
 * - Dynamic limit adjustment based on request history
 * - Trusted IP bypass
 * - Per-key analytics
 */

import { logger } from "./logger.utils";

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface TokenBucket {
  capacity: number;
  refillRate: number; // tokens per second
  tokens: number;
  lastRefill: Date;
}

export interface RateLimitConfig {
  algorithm: "token-bucket" | "sliding-window" | "fixed-window";
  capacity: number;
  refillRate: number; // tokens per second
  burstSize: number;
  dynamicAdjustment: boolean;
}

export interface TokenBucketResult {
  allowed: boolean;
  tokensRemaining: number;
  capacity: number;
  retryAfterMs: number;
  algorithm: RateLimitConfig["algorithm"];
}

export interface BucketAnalytics {
  key: string;
  totalRequests: number;
  blockedRequests: number;
  lastRequestAt: Date | null;
  blockRate: number; // 0–1
}

// ─── Trusted IPs ──────────────────────────────────────────────────────────────

const trustedIPs = new Set<string>(
  (process.env.RATE_LIMIT_TRUSTED_IPS ?? "")
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean),
);

export function isTrustedIP(ip: string): boolean {
  return trustedIPs.has(ip);
}

export function addTrustedIP(ip: string): void {
  trustedIPs.add(ip);
}

export function removeTrustedIP(ip: string): void {
  trustedIPs.delete(ip);
}

// ─── Analytics Store ──────────────────────────────────────────────────────────

interface AnalyticsEntry {
  total: number;
  blocked: number;
  lastAt: Date | null;
}

const analyticsStore = new Map<string, AnalyticsEntry>();

function recordAnalytics(key: string, blocked: boolean): void {
  const entry = analyticsStore.get(key) ?? {
    total: 0,
    blocked: 0,
    lastAt: null,
  };
  entry.total += 1;
  if (blocked) entry.blocked += 1;
  entry.lastAt = new Date();
  analyticsStore.set(key, entry);
}

export function getAnalytics(key: string): BucketAnalytics {
  const entry = analyticsStore.get(key) ?? {
    total: 0,
    blocked: 0,
    lastAt: null,
  };
  return {
    key,
    totalRequests: entry.total,
    blockedRequests: entry.blocked,
    lastRequestAt: entry.lastAt,
    blockRate: entry.total > 0 ? entry.blocked / entry.total : 0,
  };
}

export function getAllAnalytics(): BucketAnalytics[] {
  return Array.from(analyticsStore.keys()).map(getAnalytics);
}

export function resetAnalytics(key?: string): void {
  if (key) {
    analyticsStore.delete(key);
  } else {
    analyticsStore.clear();
  }
}

// ─── Dynamic Adjustment ───────────────────────────────────────────────────────

/**
 * Adjusts effective capacity based on recent block rate.
 * High block rate → tighten; low block rate → restore to base.
 */
function dynamicCapacity(baseCapacity: number, key: string): number {
  const analytics = getAnalytics(key);
  if (analytics.totalRequests < 10) return baseCapacity;

  const { blockRate } = analytics;
  if (blockRate > 0.5) return Math.max(1, Math.floor(baseCapacity * 0.5));
  if (blockRate > 0.25) return Math.max(1, Math.floor(baseCapacity * 0.75));
  return baseCapacity;
}

// ─── In-Memory Bucket Store ───────────────────────────────────────────────────

const bucketStore = new Map<string, TokenBucket>();

function getOrCreateBucket(key: string, config: RateLimitConfig): TokenBucket {
  const existing = bucketStore.get(key);
  if (existing) return existing;

  const bucket: TokenBucket = {
    capacity: config.burstSize,
    refillRate: config.refillRate,
    tokens: config.burstSize,
    lastRefill: new Date(),
  };
  bucketStore.set(key, bucket);
  return bucket;
}

function refillBucket(bucket: TokenBucket): void {
  const now = Date.now();
  const elapsed = (now - bucket.lastRefill.getTime()) / 1000; // seconds
  const newTokens = elapsed * bucket.refillRate;
  bucket.tokens = Math.min(bucket.capacity, bucket.tokens + newTokens);
  bucket.lastRefill = new Date(now);
}

// ─── Sliding Window (in-memory) ───────────────────────────────────────────────

interface SlidingEntry {
  timestamps: number[];
}

const slidingStore = new Map<string, SlidingEntry>();

function slidingWindowCheck(
  key: string,
  windowMs: number,
  max: number,
): boolean {
  const now = Date.now();
  const windowStart = now - windowMs;
  const entry = slidingStore.get(key) ?? { timestamps: [] };
  entry.timestamps = entry.timestamps.filter((t) => t > windowStart);
  entry.timestamps.push(now);
  slidingStore.set(key, entry);
  return entry.timestamps.length <= max;
}

// ─── Fixed Window (in-memory) ─────────────────────────────────────────────────

interface FixedEntry {
  count: number;
  windowStart: number;
}

const fixedStore = new Map<string, FixedEntry>();

function fixedWindowCheck(key: string, windowMs: number, max: number): boolean {
  const now = Date.now();
  const entry = fixedStore.get(key);

  if (!entry || now - entry.windowStart >= windowMs) {
    fixedStore.set(key, { count: 1, windowStart: now });
    return true;
  }

  entry.count += 1;
  return entry.count <= max;
}

// ─── Redis Token Bucket ───────────────────────────────────────────────────────

let redisClient: any = null;
let redisAvailable = false;

async function getRedis(): Promise<any | null> {
  if (redisClient) return redisAvailable ? redisClient : null;
  const url = process.env.REDIS_URL;
  if (!url) return null;

  try {
    const { default: Redis } = await import("ioredis");
    redisClient = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      enableOfflineQueue: false,
    });
    redisClient.on("error", () => {
      redisAvailable = false;
    });
    redisClient.on("connect", () => {
      redisAvailable = true;
    });
    await redisClient.connect();
    return redisClient;
  } catch {
    return null;
  }
}

/**
 * Token bucket via Redis hash.
 * Uses a Lua script for atomic read-modify-write.
 */
const TOKEN_BUCKET_SCRIPT = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])

local data = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens = tonumber(data[1]) or capacity
local last_refill = tonumber(data[2]) or now

local elapsed = (now - last_refill) / 1000
local new_tokens = math.min(capacity, tokens + elapsed * refill_rate)

local allowed = 0
if new_tokens >= cost then
  new_tokens = new_tokens - cost
  allowed = 1
end

redis.call('HMSET', key, 'tokens', new_tokens, 'last_refill', now)
redis.call('PEXPIRE', key, math.ceil(capacity / refill_rate * 1000) + 1000)

return {allowed, math.floor(new_tokens * 1000)}
`;

async function tokenBucketRedis(
  client: any,
  key: string,
  config: RateLimitConfig,
  effectiveCapacity: number,
): Promise<{ allowed: boolean; tokensRemaining: number }> {
  const result: [number, number] = await client.eval(
    TOKEN_BUCKET_SCRIPT,
    1,
    `tb:${key}`,
    effectiveCapacity,
    config.refillRate,
    Date.now(),
    1,
  );
  return { allowed: result[0] === 1, tokensRemaining: result[1] / 1000 };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export class TokenBucketLimiter {
  /**
   * Consume one token for the given key.
   * Returns whether the request is allowed and remaining tokens.
   */
  static async consume(
    key: string,
    config: RateLimitConfig,
  ): Promise<TokenBucketResult> {
    const effectiveCapacity = config.dynamicAdjustment
      ? dynamicCapacity(config.capacity, key)
      : config.capacity;

    let allowed: boolean;
    let tokensRemaining: number;

    if (config.algorithm === "token-bucket") {
      try {
        const client = await getRedis();
        if (client && redisAvailable) {
          const r = await tokenBucketRedis(
            client,
            key,
            config,
            effectiveCapacity,
          );
          allowed = r.allowed;
          tokensRemaining = r.tokensRemaining;
        } else {
          const bucket = getOrCreateBucket(key, {
            ...config,
            burstSize: effectiveCapacity,
          });
          refillBucket(bucket);
          if (bucket.tokens >= 1) {
            bucket.tokens -= 1;
            allowed = true;
          } else {
            allowed = false;
          }
          tokensRemaining = bucket.tokens;
        }
      } catch (err: any) {
        logger.warn("TokenBucketLimiter Redis error, falling back to memory", {
          error: err.message,
        });
        const bucket = getOrCreateBucket(key, {
          ...config,
          burstSize: effectiveCapacity,
        });
        refillBucket(bucket);
        if (bucket.tokens >= 1) {
          bucket.tokens -= 1;
          allowed = true;
        } else {
          allowed = false;
        }
        tokensRemaining = bucket.tokens;
      }
    } else if (config.algorithm === "sliding-window") {
      const windowMs = (effectiveCapacity / config.refillRate) * 1000;
      allowed = slidingWindowCheck(key, windowMs, effectiveCapacity);
      tokensRemaining = allowed ? effectiveCapacity - 1 : 0;
    } else {
      // fixed-window
      const windowMs = (effectiveCapacity / config.refillRate) * 1000;
      allowed = fixedWindowCheck(key, windowMs, effectiveCapacity);
      tokensRemaining = allowed ? effectiveCapacity - 1 : 0;
    }

    recordAnalytics(key, !allowed);

    const retryAfterMs = allowed
      ? 0
      : Math.ceil((1 / config.refillRate) * 1000);

    return {
      allowed,
      tokensRemaining: Math.max(0, tokensRemaining),
      capacity: effectiveCapacity,
      retryAfterMs,
      algorithm: config.algorithm,
    };
  }

  /**
   * Reset the bucket for a key (e.g. after successful auth).
   */
  static async reset(key: string): Promise<void> {
    bucketStore.delete(key);
    slidingStore.delete(key);
    fixedStore.delete(key);
    try {
      const client = await getRedis();
      if (client && redisAvailable) {
        await client.del(`tb:${key}`);
      }
    } catch {
      // best-effort
    }
  }

  static isDistributed(): boolean {
    return redisAvailable;
  }
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of slidingStore.entries()) {
    if (entry.timestamps.length === 0) slidingStore.delete(key);
    else if (now - entry.timestamps[entry.timestamps.length - 1] > 3_600_000) {
      slidingStore.delete(key);
    }
  }
  for (const [key, entry] of fixedStore.entries()) {
    if (now - entry.windowStart > 3_600_000) fixedStore.delete(key);
  }
}, 300_000);
