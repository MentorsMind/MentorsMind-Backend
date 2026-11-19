/**
 * Cache layer abstraction for the multi-tier hierarchy (issue #864).
 *
 * The orchestrator talks to layers through this interface only, so L1
 * (in-process), L2 (Redis) and L3 (CDN) are interchangeable and each is
 * testable with a fake. Keeping the contract this narrow is what lets the
 * promotion/demotion logic be unit-tested without a Redis server.
 */

export interface CacheLayer {
  /** Human name used in metrics and logs, e.g. "L1". */
  readonly name: string;

  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;

  /**
   * Whether this layer can serve a read at all.
   *
   * A layer that is down must report `false` rather than throw on every call:
   * the orchestrator degrades past it, and an outage in L2 should not take
   * L1 hits down with it.
   */
  isAvailable(): boolean;
}

export interface MemoryLayerOptions {
  /** Hard cap on entries. Oldest-inserted are evicted first. */
  maxEntries?: number;
  /** Injected clock, so TTL expiry is testable without waiting. */
  now?: () => number;
}

interface MemoryEntry {
  value: unknown;
  expiresAt: number;
}

/**
 * L1: in-process cache.
 *
 * Bounded on purpose. An unbounded in-process map in a long-lived Node service
 * is a memory leak with extra steps — it grows until the container is OOM-killed,
 * and the symptom (a restart loop under load) looks nothing like its cause.
 *
 * Eviction is insertion-ordered rather than true LRU: `Map` already preserves
 * insertion order, so this costs nothing, and the entries that matter are
 * re-set on write anyway. A real LRU would need a second structure for a
 * marginal hit-rate gain at this tier.
 */
export class MemoryCacheLayer implements CacheLayer {
  readonly name = 'L1';

  private readonly store = new Map<string, MemoryEntry>();
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor({ maxEntries = 5_000, now = Date.now }: MemoryLayerOptions = {}) {
    this.maxEntries = Math.max(1, maxEntries);
    this.now = now;
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;

    if (entry.expiresAt <= this.now()) {
      this.store.delete(key);
      return null;
    }

    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    // Re-insert so a refreshed key moves to the back of the eviction order.
    this.store.delete(key);

    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next();
      if (!oldest.done) this.store.delete(oldest.value);
    }

    this.store.set(key, {
      value,
      expiresAt: this.now() + ttlSeconds * 1000,
    });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  isAvailable(): boolean {
    return true;
  }

  /** Entry count, for metrics and tests. */
  size(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }
}
