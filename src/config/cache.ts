/**
 * Cache Configuration
 * 
 * Centralized cache configuration for Redis and in-memory caching
 */

export interface CacheConfig {
  redis: {
    host: string;
    port: number;
    password?: string;
    db: number;
    keyPrefix: string;
    ttl: number; // Default TTL in seconds
  };
  memory: {
    maxSize: number; // Max number of items
    ttl: number; // Default TTL in milliseconds
  };
  eventReplay: {
    batchSize: number;
    maxRetries: number;
    retryDelay: number;
  };
}

export const cacheConfig: CacheConfig = {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || '0'),
    keyPrefix: process.env.REDIS_KEY_PREFIX || 'mentorsmind:',
    ttl: parseInt(process.env.CACHE_TTL || '3600'), // 1 hour default
  },
  memory: {
    maxSize: parseInt(process.env.MEMORY_CACHE_MAX_SIZE || '1000'),
    ttl: parseInt(process.env.MEMORY_CACHE_TTL || '300000'), // 5 minutes default
  },
  eventReplay: {
    batchSize: parseInt(process.env.EVENT_REPLAY_BATCH_SIZE || '100'),
    maxRetries: parseInt(process.env.EVENT_REPLAY_MAX_RETRIES || '3'),
    retryDelay: parseInt(process.env.EVENT_REPLAY_RETRY_DELAY || '1000'),
  },
};

// Export cache as alias for cacheConfig
export const cache = cacheConfig;

export default cacheConfig;