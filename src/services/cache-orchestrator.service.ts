/**
 * Multi-layered cache orchestrator (issue #864).
 *
 * Fronts the existing cache stack with a tier hierarchy and a dependency graph:
 *
 *   L1  in-process LRU + TTL  — nanoseconds, per instance, bounded
 *   L2  Redis via CacheService — shared across instances, survives a restart
 *   L3  CDN via CDNService     — edge, purged rather than read through
 *
 * A read walks L1 → L2 → loader, promoting on the way back up. A write fans out
 * to the tiers the caller asks for. Invalidation is transitive: entries declare
 * dependency tags, tags may depend on other tags, and invalidating a tag clears
 * everything reachable from it.
 *
 * Because L1 lives inside a single process, every invalidation is also broadcast
 * over Redis pub/sub so sibling instances drop their copy. Without that, one
 * instance serves stale data until its TTL expires.
 */

import { Logger } from "../utils/logger";

const logger = new Logger("CacheOrchestrator");

export type CacheTier = "l1" | "l2" | "l3";

export interface CacheSetOptions {
  /** Time to live in seconds. */
  ttl?: number;
  /** Dependency tags this entry is invalidated by. */
  dependencies?: string[];
  /** Tiers to write to. Defaults to L1 + L2. */
  tiers?: CacheTier[];
}

export interface CacheGetOptions extends CacheSetOptions {
  /**
   * Serve an expired L1 entry while a refresh runs in the background. Bounds
   * the tail latency a cold key would otherwise add to a request.
   */
  staleWhileRevalidate?: boolean;
}

export interface CacheReadResult<T> {
  value: T | null;
  /** Tier the value came from, or `null` on a full miss. */
  tier: CacheTier | "loader" | null;
  /** True when a stale value was served while a refresh runs. */
  stale: boolean;
}

export interface OrchestratorEvent {
  type: "hit" | "miss" | "set" | "invalidate";
  key: string;
  tier: CacheTier | "loader" | null;
  namespace: string;
  durationMs: number;
}

export type OrchestratorObserver = (event: OrchestratorEvent) => void;

/** Broadcast shape for cross-instance L1 invalidation. */
export interface InvalidationMessage {
  origin: string;
  keys: string[];
  tags: string[];
}

interface L1Entry {
  value: unknown;
  expiresAt: number;
  /** Insertion counter, used for LRU ordering. */
  touched: number;
}

export const DEFAULT_TTL_SECONDS = 300;
export const DEFAULT_L1_MAX_ENTRIES = 5_000;

/**
 * Bounded in-process store. A plain Map grows without limit and a long-lived
 * API process will eventually pay for that in RSS, so entries are evicted by
 * least-recent use once the ceiling is reached.
 */
export class L1Store {
  private entries = new Map<string, L1Entry>();
  private clock = 0;
  private evictions = 0;

  constructor(private readonly maxEntries: number = DEFAULT_L1_MAX_ENTRIES) {}

  get<T>(key: string, now = Date.now()): { value: T; expired: boolean } | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    entry.touched = ++this.clock;
    return { value: entry.value as T, expired: entry.expiresAt <= now };
  }

  set<T>(key: string, value: T, ttlSeconds: number, now = Date.now()): void {
    this.entries.set(key, {
      value,
      expiresAt: now + ttlSeconds * 1000,
      touched: ++this.clock,
    });
    this.evictIfNeeded();
  }

  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  get evictionCount(): number {
    return this.evictions;
  }

  /** Drop expired entries. Cheap enough to run on a timer. */
  prune(now = Date.now()): number {
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
        removed++;
      }
    }
    return removed;
  }

  private evictIfNeeded(): void {
    while (this.entries.size > this.maxEntries) {
      let oldestKey: string | null = null;
      let oldestTouch = Infinity;
      for (const [key, entry] of this.entries) {
        if (entry.touched < oldestTouch) {
          oldestTouch = entry.touched;
          oldestKey = key;
        }
      }
      if (oldestKey === null) return;
      this.entries.delete(oldestKey);
      this.evictions++;
    }
  }
}

/**
 * Tracks which cache keys and tags a tag invalidates.
 *
 * Edges point from a dependency to its dependents, so invalidating
 * `mentor:42` reaches every key that declared it — and every tag that declared
 * it, transitively.
 */
export class DependencyGraph {
  private tagToKeys = new Map<string, Set<string>>();
  private tagToTags = new Map<string, Set<string>>();
  private keyToTags = new Map<string, Set<string>>();

  addKey(key: string, tags: string[]): void {
    if (tags.length === 0) return;
    const existing = this.keyToTags.get(key) ?? new Set<string>();
    for (const tag of tags) {
      existing.add(tag);
      const keys = this.tagToKeys.get(tag) ?? new Set<string>();
      keys.add(key);
      this.tagToKeys.set(tag, keys);
    }
    this.keyToTags.set(key, existing);
  }

  /** Declare that invalidating `dependency` must also invalidate `tag`. */
  addTagEdge(tag: string, dependency: string): void {
    const dependents = this.tagToTags.get(dependency) ?? new Set<string>();
    dependents.add(tag);
    this.tagToTags.set(dependency, dependents);
  }

  removeKey(key: string): void {
    const tags = this.keyToTags.get(key);
    if (!tags) return;
    for (const tag of tags) {
      this.tagToKeys.get(tag)?.delete(key);
    }
    this.keyToTags.delete(key);
  }

  /**
   * Every key reachable from `tags`. Visited tags are tracked so a cycle in the
   * graph terminates instead of recursing forever.
   */
  resolve(tags: string[]): string[] {
    const seenTags = new Set<string>();
    const keys = new Set<string>();
    const queue = [...tags];

    while (queue.length > 0) {
      const tag = queue.shift() as string;
      if (seenTags.has(tag)) continue;
      seenTags.add(tag);

      for (const key of this.tagToKeys.get(tag) ?? []) keys.add(key);
      for (const dependent of this.tagToTags.get(tag) ?? [])
        queue.push(dependent);
    }

    return [...keys];
  }

  clear(): void {
    this.tagToKeys.clear();
    this.tagToTags.clear();
    this.keyToTags.clear();
  }
}

/** Minimal surface the orchestrator needs from the L2 store. */
export interface L2Store {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
}

/** Minimal surface the orchestrator needs to purge the edge. */
export interface L3Purger {
  purge(keys: string[]): Promise<void>;
}

/** Minimal surface for broadcasting invalidations to sibling instances. */
export interface InvalidationBroadcaster {
  publish(message: InvalidationMessage): Promise<void>;
  subscribe(handler: (message: InvalidationMessage) => void): Promise<void>;
}

/**
 * Default L2, resolved on first use rather than at import time.
 *
 * `cache.service` pulls in the Redis config, which validates the process
 * environment on import. Requiring it lazily keeps this module importable from a
 * unit test that injects its own store.
 */
const lazyRedisL2: L2Store = {
  async get<T>(key: string): Promise<T | null> {
    return resolveCacheService().get<T>(key);
  },
  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    return resolveCacheService().set<T>(key, value, ttlSeconds);
  },
  async del(key: string): Promise<void> {
    return resolveCacheService().del(key);
  },
};

function resolveCacheService(): L2Store {
  return require("./cache.service").CacheService as L2Store;
}

export interface OrchestratorOptions {
  l1?: L1Store;
  l2?: L2Store;
  l3?: L3Purger;
  broadcaster?: InvalidationBroadcaster;
  instanceId?: string;
}

export class CacheOrchestrator {
  private readonly l1: L1Store;
  private readonly l2: L2Store;
  private readonly l3?: L3Purger;
  private readonly broadcaster?: InvalidationBroadcaster;
  private readonly instanceId: string;
  private readonly graph = new DependencyGraph();
  private readonly observers: OrchestratorObserver[] = [];
  /** In-flight loaders, so a cold key is loaded once rather than per caller. */
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(options: OrchestratorOptions = {}) {
    this.l1 = options.l1 ?? new L1Store();
    this.l2 = options.l2 ?? lazyRedisL2;
    this.l3 = options.l3;
    this.broadcaster = options.broadcaster;
    this.instanceId = options.instanceId ?? `${process.pid}-${Date.now()}`;
  }

  observe(observer: OrchestratorObserver): void {
    this.observers.push(observer);
  }

  /** Start listening for invalidations published by sibling instances. */
  async connect(): Promise<void> {
    if (!this.broadcaster) return;
    await this.broadcaster.subscribe((message) => {
      if (message.origin === this.instanceId) return;
      for (const key of message.keys) this.l1.delete(key);
      for (const key of this.graph.resolve(message.tags)) this.l1.delete(key);
    });
  }

  /**
   * Read through the hierarchy, falling back to `loader` on a full miss.
   *
   * The loaded value is written back to every tier in `options.tiers`, so the
   * next reader is served from L1.
   */
  async get<T>(
    key: string,
    loader: () => Promise<T>,
    options: CacheGetOptions = {},
  ): Promise<CacheReadResult<T>> {
    const started = Date.now();
    const namespace = namespaceOf(key);

    const local = this.l1.get<T>(key);
    if (local && !local.expired) {
      this.emit({
        type: "hit",
        key,
        tier: "l1",
        namespace,
        durationMs: Date.now() - started,
      });
      return { value: local.value, tier: "l1", stale: false };
    }

    // Serve the expired copy and refresh behind the request. The refresh is
    // deliberately not awaited; failures are logged, not surfaced to the caller.
    if (local && options.staleWhileRevalidate) {
      void this.refresh(key, loader, options).catch((err: Error) =>
        logger.warn(`Background refresh failed for ${key}: ${err.message}`),
      );
      this.emit({
        type: "hit",
        key,
        tier: "l1",
        namespace,
        durationMs: Date.now() - started,
      });
      return { value: local.value, tier: "l1", stale: true };
    }

    const remote = await this.l2.get<T>(key);
    if (remote !== null && remote !== undefined) {
      this.promote(key, remote, options);
      this.emit({
        type: "hit",
        key,
        tier: "l2",
        namespace,
        durationMs: Date.now() - started,
      });
      return { value: remote, tier: "l2", stale: false };
    }

    const value = await this.loadOnce(key, loader, options);
    this.emit({
      type: "miss",
      key,
      tier: "loader",
      namespace,
      durationMs: Date.now() - started,
    });
    return { value, tier: "loader", stale: false };
  }

  /** Write a value to the requested tiers and record its dependencies. */
  async set<T>(
    key: string,
    value: T,
    options: CacheSetOptions = {},
  ): Promise<void> {
    const started = Date.now();
    const ttl = options.ttl ?? DEFAULT_TTL_SECONDS;
    const tiers = options.tiers ?? ["l1", "l2"];

    if (tiers.includes("l1")) this.l1.set(key, value, ttl);
    // Recorded before the L2 write so the entry is invalidatable even if Redis
    // is unavailable — the L1 copy still needs to be reachable by its tags.
    if (options.dependencies?.length)
      this.graph.addKey(key, options.dependencies);
    if (tiers.includes("l2")) await this.l2.set(key, value, ttl);

    this.emit({
      type: "set",
      key,
      tier: null,
      namespace: namespaceOf(key),
      durationMs: Date.now() - started,
    });
  }

  /** Declare that invalidating `dependency` must also invalidate `tag`. */
  dependsOn(tag: string, dependency: string): void {
    this.graph.addTagEdge(tag, dependency);
  }

  /** Drop specific keys from every tier and tell sibling instances to do the same. */
  async invalidateKeys(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    for (const key of keys) {
      this.l1.delete(key);
      this.graph.removeKey(key);
    }
    await Promise.all(keys.map((key) => this.l2.del(key)));
    if (this.l3) await this.l3.purge(keys);
    await this.broadcast(keys, []);

    for (const key of keys) {
      this.emit({
        type: "invalidate",
        key,
        tier: null,
        namespace: namespaceOf(key),
        durationMs: 0,
      });
    }
  }

  /**
   * Invalidate everything reachable from `tags`.
   *
   * Returns the keys that were dropped, which is what makes the blast radius of
   * a dependency change observable rather than guesswork.
   */
  async invalidateTags(tags: string[]): Promise<string[]> {
    const keys = this.graph.resolve(tags);
    await this.invalidateKeys(keys);
    await this.broadcast([], tags);
    return keys;
  }

  /** Drop this instance's L1 only. Used by tests and by memory pressure handlers. */
  clearLocal(): void {
    this.l1.clear();
  }

  get localSize(): number {
    return this.l1.size;
  }

  get localEvictions(): number {
    return this.l1.evictionCount;
  }

  pruneLocal(): number {
    return this.l1.prune();
  }

  private async loadOnce<T>(
    key: string,
    loader: () => Promise<T>,
    options: CacheSetOptions,
  ): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing as Promise<T>;

    const promise = (async () => {
      try {
        const value = await loader();
        await this.set(key, value, options);
        return value;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }

  private async refresh<T>(
    key: string,
    loader: () => Promise<T>,
    options: CacheSetOptions,
  ): Promise<void> {
    await this.loadOnce(key, loader, options);
  }

  private promote<T>(key: string, value: T, options: CacheSetOptions): void {
    const tiers = options.tiers ?? ["l1", "l2"];
    if (!tiers.includes("l1")) return;
    this.l1.set(key, value, options.ttl ?? DEFAULT_TTL_SECONDS);
    if (options.dependencies?.length)
      this.graph.addKey(key, options.dependencies);
  }

  private async broadcast(keys: string[], tags: string[]): Promise<void> {
    if (!this.broadcaster) return;
    try {
      await this.broadcaster.publish({ origin: this.instanceId, keys, tags });
    } catch (err) {
      // A failed broadcast leaves siblings stale until TTL, which is degraded
      // but not incorrect. It must not fail the invalidation that triggered it.
      logger.warn(`Invalidation broadcast failed: ${(err as Error).message}`);
    }
  }

  private emit(event: OrchestratorEvent): void {
    for (const observer of this.observers) {
      try {
        observer(event);
      } catch (err) {
        logger.warn(`Cache observer threw: ${(err as Error).message}`);
      }
    }
  }
}

/** First segment of a colon-delimited key, used to group analytics. */
export function namespaceOf(key: string): string {
  const index = key.indexOf(":");
  return index === -1 ? key : key.slice(0, index);
}

export const cacheOrchestrator = new CacheOrchestrator();
