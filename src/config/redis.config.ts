import config from './index';

export const redisConfig = {
  url: config.redis.url,
  clusterNodes: config.redis.clusterNodes,
  clusterEnabled: config.redis.clusterEnabled || false,
  options: {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
    enableOfflineQueue: false,
    keyPrefix: 'mm:',
    redisOptions: {
      tls: config.redis.tlsEnabled ? {} : undefined,
    },
  },
  /** Default cache TTL in seconds when none is specified */
  defaultTtl: 300 as number,
  /** Whether to enable cache hit/miss logging */
  logMetrics: config.isDevelopment,
  /** Default cache namespace for key prefixing */
  defaultNamespace: 'mm',
  /** Lock TTL in milliseconds */
  defaultLockTtl: 30000,
  /** Write-behind queue size limit */
  writeBehindQueueLimit: 1000,
};
