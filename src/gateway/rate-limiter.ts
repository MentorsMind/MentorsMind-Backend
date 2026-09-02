/**
 * Token-bucket rate limiter
 *
 * In-memory, per-key token bucket used by the gateway to throttle clients
 * before a request is proxied upstream. The bucket capacity is
 * `requestsPerWindow + burst`; tokens refill at `requestsPerWindow / windowMs`.
 *
 * This is deliberately process-local. For multi-instance deployments the
 * gateway can be layered on top of the existing Redis distributed limiter
 * (`middleware/distributed-rate-limit.middleware.ts`); this class keeps the
 * gateway self-contained and dependency-free.
 */

import type { RateLimitResult } from "./types";

interface Bucket {
  tokens: number;
  lastRefill: number;
}

export interface RateLimiterOptions {
  requestsPerWindow: number;
  windowMs: number;
  burst: number;
}

export class TokenBucketRateLimiter {
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly windowMs: number;
  private readonly sustained: number;
  private readonly buckets = new Map<string, Bucket>();
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(opts: RateLimiterOptions) {
    this.sustained = Math.max(1, opts.requestsPerWindow);
    this.windowMs = Math.max(1, opts.windowMs);
    this.capacity = this.sustained + Math.max(0, opts.burst);
    this.refillPerMs = this.sustained / this.windowMs;
  }

  /** Begin periodic eviction of idle buckets to bound memory. */
  start(): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => this.sweep(), this.windowMs * 2);
    this.sweepTimer.unref?.();
  }

  stop(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  /** Consume a single token for `key`. */
  consume(key: string, cost = 1): RateLimitResult {
    const now = Date.now();
    const bucket = this.buckets.get(key) ?? {
      tokens: this.capacity,
      lastRefill: now,
    };

    const elapsed = now - bucket.lastRefill;
    if (elapsed > 0) {
      bucket.tokens = Math.min(
        this.capacity,
        bucket.tokens + elapsed * this.refillPerMs,
      );
      bucket.lastRefill = now;
    }

    let allowed = false;
    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      allowed = true;
    }

    this.buckets.set(key, bucket);

    const deficit = allowed ? 0 : cost - bucket.tokens;
    const retryAfterMs = allowed
      ? 0
      : Math.ceil(deficit / this.refillPerMs);

    return {
      allowed,
      limit: this.sustained,
      remaining: Math.max(0, Math.floor(bucket.tokens)),
      retryAfterMs,
      resetAt: now + Math.ceil((this.capacity - bucket.tokens) / this.refillPerMs),
    };
  }

  /** Current number of tracked keys (diagnostics/tests). */
  size(): number {
    return this.buckets.size;
  }

  reset(): void {
    this.buckets.clear();
  }

  private sweep(): void {
    const now = Date.now();
    const idleCutoff = this.windowMs * 3;
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastRefill > idleCutoff && bucket.tokens >= this.capacity) {
        this.buckets.delete(key);
      }
    }
  }
}
