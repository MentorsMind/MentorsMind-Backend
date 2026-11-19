import { redis } from "../config/redis";

export interface RateLimitAnalytics {
  key: string;
  totalRequests: number;
  allowedRequests: number;
  blockedRequests: number;
  blockRate: number;
  lastRequestAt: Date | null;
}

interface AnalyticsEntry {
  totalRequests: number;
  allowedRequests: number;
  blockedRequests: number;
  lastRequestAt: number;
}

const memoryAnalytics = new Map<string, AnalyticsEntry>();
const analyticsTtlSeconds = 24 * 60 * 60;

function analyticsKey(key: string): string {
  return `rl:analytics:${key}`;
}

function toAnalytics(key: string, entry: AnalyticsEntry): RateLimitAnalytics {
  return {
    key,
    totalRequests: entry.totalRequests,
    allowedRequests: entry.allowedRequests,
    blockedRequests: entry.blockedRequests,
    blockRate: entry.totalRequests ? entry.blockedRequests / entry.totalRequests : 0,
    lastRequestAt: entry.lastRequestAt ? new Date(entry.lastRequestAt) : null,
  };
}

export class RateLimitAnalyticsService {
  static async record(key: string, allowed: boolean): Promise<void> {
    const redisKey = analyticsKey(key);
    try {
      const pipeline = redis.pipeline();
      pipeline.hincrby(redisKey, "totalRequests", 1);
      pipeline.hincrby(redisKey, allowed ? "allowedRequests" : "blockedRequests", 1);
      pipeline.hset(redisKey, "lastRequestAt", Date.now());
      pipeline.expire(redisKey, analyticsTtlSeconds);
      await pipeline.exec();
      return;
    } catch {
      const current = memoryAnalytics.get(key) ?? {
        totalRequests: 0,
        allowedRequests: 0,
        blockedRequests: 0,
        lastRequestAt: 0,
      };
      current.totalRequests += 1;
      if (allowed) current.allowedRequests += 1;
      else current.blockedRequests += 1;
      current.lastRequestAt = Date.now();
      memoryAnalytics.set(key, current);
    }
  }

  static async get(key: string): Promise<RateLimitAnalytics> {
    try {
      const values = await redis.hgetall(analyticsKey(key));
      if (Object.keys(values).length > 0) {
        return toAnalytics(key, {
          totalRequests: Number(values.totalRequests ?? 0),
          allowedRequests: Number(values.allowedRequests ?? 0),
          blockedRequests: Number(values.blockedRequests ?? 0),
          lastRequestAt: Number(values.lastRequestAt ?? 0),
        });
      }
    } catch {
      // Fall through to local analytics when Redis is unavailable.
    }
    return toAnalytics(key, memoryAnalytics.get(key) ?? {
      totalRequests: 0,
      allowedRequests: 0,
      blockedRequests: 0,
      lastRequestAt: 0,
    });
  }

  static async getMany(keys: string[]): Promise<RateLimitAnalytics[]> {
    return Promise.all(keys.map((key) => this.get(key)));
  }

  static clearMemory(): void {
    memoryAnalytics.clear();
  }
}