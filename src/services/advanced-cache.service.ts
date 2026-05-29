import { redis } from '../config/redis';
import { redisConfig } from '../config/redis.config';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

// --- Types ---

export interface CacheStrategy {
  pattern: 'cache-aside' | 'write-through' | 'write-behind';
  ttl: number;
  namespace: string;
  invalidationRules: InvalidationRule[];
}

export interface InvalidationRule {
  eventType: string;
  invalidatePatterns: string[];
  invalidateKeys: string[];
}

export interface AdvancedCacheMetrics {
  hitRate: number;
  missRate: number;
  evictionRate: number;
  memoryUsage: number;
  keyCount: number;
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  errors: number;
}

export interface DistributedLock {
  key: string;
  value: string;
  ttl: number;
  acquiredAt: number;
}

interface WriteBehindTask {
  key: string;
  value: any;
  ttl: number;
  writeFn: (value: any) => Promise<void>;
  timestamp: number;
}

// --- Key Namespacing ---
export class CacheKeyBuilder {
  static create(namespace: string, ...parts: string[]): string {
    return `${redisConfig.defaultNamespace}:${namespace}:${parts.join(':')}`;
  }

  static parse(key: string): { namespace: string; parts: string[] } | null {
    const parts = key.split(':');
    if (parts.length < 3) return null;
    return {
      namespace: parts[1],
      parts: parts.slice(2),
    };
  }

  static pattern(namespace: string, ...wildcards: string[]): string {
    return `${redisConfig.defaultNamespace}:${namespace}:${wildcards.join(':')}`;
  }
}

// --- Metrics ---
class CacheMetricsTracker {
  private metrics: AdvancedCacheMetrics = {
    hitRate: 0,
    missRate: 0,
    evictionRate: 0,
    memoryUsage: 0,
    keyCount: 0,
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    errors: 0,
  };

  hit(): void {
    this.metrics.hits++;
    this.updateRates();
  }

  miss(): void {
    this.metrics.misses++;
    this.updateRates();
  }

  set(): void {
    this.metrics.sets++;
  }

  delete(): void {
    this.metrics.deletes++;
  }

  error(): void {
    this.metrics.errors++;
  }

  private updateRates(): void {
    const total = this.metrics.hits + this.metrics.misses;
    if (total > 0) {
      this.metrics.hitRate = this.metrics.hits / total;
      this.metrics.missRate = this.metrics.misses / total;
    }
  }

  async updateSystemMetrics(): Promise<void> {
    try {
      const info = await redis.info('memory');
      const memorySection = info.split('\n').find(line => line.startsWith('used_memory:'));
      if (memorySection) {
        this.metrics.memoryUsage = parseInt(memorySection.split(':')[1], 10);
      }
      
      const dbSize = await redis.dbsize();
      this.metrics.keyCount = dbSize;
    } catch (err) {
      logger.warn('Failed to update system cache metrics', { error: err });
    }
  }

  getMetrics(): AdvancedCacheMetrics {
    return { ...this.metrics };
  }
}

const metricsTracker = new CacheMetricsTracker();

// --- Distributed Locks ---
export class DistributedCacheLock {
  private static readonly LOCK_NAMESPACE = 'locks';

  static async acquire(
    key: string,
    ttlMs: number = redisConfig.defaultLockTtl,
  ): Promise<DistributedLock | null> {
    const lockKey = CacheKeyBuilder.create(this.LOCK_NAMESPACE, key);
    const lockValue = uuidv4();
    
    try {
      const result = await redis.set(lockKey, lockValue, 'PX', ttlMs, 'NX');
      if (result === 'OK') {
        logger.debug('Distributed lock acquired', { key, lockKey, ttlMs });
        return {
          key: lockKey,
          value: lockValue,
          ttl: ttlMs,
          acquiredAt: Date.now(),
        };
      }
      return null;
    } catch (err) {
      logger.error('Failed to acquire distributed lock', { key, error: err });
      metricsTracker.error();
      return null;
    }
  }

  static async release(lock: DistributedLock): Promise<boolean> {
    try {
      const script = `
        if redis.call("GET", KEYS[1]) == ARGV[1] then
          return redis.call("DEL", KEYS[1])
        else
          return 0
        end
      `;
      const result = await redis.eval(script, 1, lock.key, lock.value);
      logger.debug('Distributed lock released', { key: lock.key, success: result === 1 });
      return result === 1;
    } catch (err) {
      logger.error('Failed to release distributed lock', { key: lock.key, error: err });
      metricsTracker.error();
      return false;
    }
  }

  static async execute<T>(
    key: string,
    fn: () => Promise<T>,
    ttlMs: number = redisConfig.defaultLockTtl,
    retryCount: number = 3,
    retryDelayMs: number = 100,
  ): Promise<T> {
    let attempts = 0;
    while (attempts < retryCount) {
      const lock = await this.acquire(key, ttlMs);
      if (lock) {
        try {
          return await fn();
        } finally {
          await this.release(lock);
        }
      }
      attempts++;
      await new Promise(resolve => setTimeout(resolve, retryDelayMs * attempts));
    }
    throw new Error(`Failed to acquire lock for key: ${key}`);
  }
}

// --- Write Behind ---
class WriteBehindQueue {
  private queue: Map<string, WriteBehindTask> = new Map();
  private flushInterval: NodeJS.Timeout | null = null;
  private isFlushing = false;

  constructor(private flushIntervalMs: number = 5000) {}

  start(): void {
    if (this.flushInterval) return;
    this.flushInterval = setInterval(() => this.flush(), this.flushIntervalMs);
    logger.info('Write-behind queue started');
  }

  stop(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    this.flush();
    logger.info('Write-behind queue stopped');
  }

  enqueue(task: WriteBehindTask): void {
    if (this.queue.size >= redisConfig.writeBehindQueueLimit) {
      logger.warn('Write-behind queue limit reached, flushing immediately');
      this.flush();
    }
    this.queue.set(task.key, task);
  }

  private async flush(): Promise<void> {
    if (this.isFlushing || this.queue.size === 0) return;
    this.isFlushing = true;

    const tasks = Array.from(this.queue.values());
    this.queue.clear();

    for (const task of tasks) {
      try {
        await task.writeFn(task.value);
        logger.debug('Write-behind task completed', { key: task.key });
      } catch (err) {
        logger.error('Write-behind task failed', { key: task.key, error: err });
        metricsTracker.error();
      }
    }

    this.isFlushing = false;
  }
}

const writeBehindQueue = new WriteBehindQueue();

// --- Invalidation Rules ---
class InvalidationRuleManager {
  private rules: Map<string, InvalidationRule[]> = new Map();

  registerRule(rule: InvalidationRule): void {
    if (!this.rules.has(rule.eventType)) {
      this.rules.set(rule.eventType, []);
    }
    this.rules.get(rule.eventType)!.push(rule);
    logger.debug('Invalidation rule registered', { eventType: rule.eventType });
  }

  async trigger(eventType: string): Promise<void> {
    const rules = this.rules.get(eventType);
    if (!rules) return;

    for (const rule of rules) {
      for (const key of rule.invalidateKeys) {
        await AdvancedCacheService.del(key);
      }
      for (const pattern of rule.invalidatePatterns) {
        await AdvancedCacheService.invalidatePattern(pattern);
      }
    }
    logger.info('Invalidation rules triggered', { eventType, ruleCount: rules.length });
  }
}

const invalidationManager = new InvalidationRuleManager();

// --- Main Service ---
export class AdvancedCacheService {
  static async initialize(): Promise<void> {
    writeBehindQueue.start();
    setInterval(() => metricsTracker.updateSystemMetrics(), 60000);
    logger.info('Advanced cache service initialized');
  }

  static async shutdown(): Promise<void> {
    writeBehindQueue.stop();
    logger.info('Advanced cache service shutdown');
  }

  // --- Cache-Aside Pattern ---
  static async cacheAside<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttlSeconds: number = redisConfig.defaultTtl,
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const value = await fetchFn();
    await this.set(key, value, ttlSeconds);
    return value;
  }

  // --- Write-Through Pattern ---
  static async writeThrough<T>(
    key: string,
    value: T,
    writeFn: (value: T) => Promise<void>,
    ttlSeconds: number = redisConfig.defaultTtl,
  ): Promise<void> {
    await writeFn(value);
    await this.set(key, value, ttlSeconds);
  }

  // --- Write-Behind Pattern ---
  static writeBehind<T>(
    key: string,
    value: T,
    writeFn: (value: T) => Promise<void>,
    ttlSeconds: number = redisConfig.defaultTtl,
  ): void {
    this.set(key, value, ttlSeconds);
    writeBehindQueue.enqueue({
      key,
      value,
      ttl: ttlSeconds,
      writeFn: writeFn as any,
      timestamp: Date.now(),
    });
  }

  // --- Basic Operations ---
  static async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await redis.get(key);
      if (raw === null) {
        metricsTracker.miss();
        return null;
      }
      metricsTracker.hit();
      return JSON.parse(raw) as T;
    } catch (err) {
      logger.warn('Cache get error', { key, error: err });
      metricsTracker.error();
      return null;
    }
  }

  static async set<T>(
    key: string,
    value: T,
    ttlSeconds: number = redisConfig.defaultTtl,
  ): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      await redis.setex(key, ttlSeconds, serialized);
      metricsTracker.set();
    } catch (err) {
      logger.warn('Cache set error', { key, error: err });
      metricsTracker.error();
    }
  }

  static async del(key: string): Promise<void> {
    try {
      await redis.del(key);
      metricsTracker.delete();
    } catch (err) {
      logger.warn('Cache del error', { key, error: err });
      metricsTracker.error();
    }
  }

  static async invalidatePattern(pattern: string): Promise<void> {
    try {
      const keys: string[] = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
      logger.debug('Invalidated cache pattern', { pattern, count: keys.length });
    } catch (err) {
      logger.warn('Cache invalidate pattern error', { pattern, error: err });
      metricsTracker.error();
    }
  }

  // --- Cache Warming ---
  static async warm<T>(
    entries: Array<{ key: string; ttl: number; fetchFn: () => Promise<T> }>,
  ): Promise<void> {
    await Promise.allSettled(
      entries.map(({ key, ttl, fetchFn }) => this.cacheAside(key, fetchFn, ttl)),
    );
    logger.info('Cache warmed', { count: entries.length });
  }

  // --- Invalidation ---
  static registerInvalidationRule(rule: InvalidationRule): void {
    invalidationManager.registerRule(rule);
  }

  static triggerInvalidation(eventType: string): Promise<void> {
    return invalidationManager.trigger(eventType);
  }

  // --- Metrics ---
  static getMetrics(): AdvancedCacheMetrics {
    return metricsTracker.getMetrics();
  }
}
