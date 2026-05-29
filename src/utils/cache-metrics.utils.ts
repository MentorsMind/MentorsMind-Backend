/// <reference lib="dom" />
/**
 * Cache Metrics Utility
 * Provides Prometheus metrics for cache operations (hits, misses, errors)
 */

import { CacheService } from '../services/cache.service';
import { logger } from './logger.utils';

/**
 * Prometheus metric definitions for cache operations
 */
export interface CacheMetricDefinitions {
  hits: {
    name: string;
    help: string;
    type: 'counter';
  };
  misses: {
    name: string;
    help: string;
    type: 'counter';
  };
  errors: {
    name: string;
    help: string;
    type: 'counter';
  };
  hitRate: {
    name: string;
    help: string;
    type: 'gauge';
  };
  backend: {
    name: string;
    help: string;
    type: 'gauge';
  };
}

/**
 * Get cache metrics definitions for Prometheus registration
 */
export function getCacheMetricDefinitions(): CacheMetricDefinitions {
  return {
    hits: {
      name: 'cache_hits_total',
      help: 'Total number of cache hits (successful lookups)',
      type: 'counter',
    },
    misses: {
      name: 'cache_misses_total',
      help: 'Total number of cache misses (lookups that resulted in DB/API calls)',
      type: 'counter',
    },
    errors: {
      name: 'cache_errors_total',
      help: 'Total number of cache operation errors',
      type: 'counter',
    },
    hitRate: {
      name: 'cache_hit_rate',
      help: 'Current cache hit rate as a percentage (0-100)',
      type: 'gauge',
    },
    backend: {
      name: 'cache_backend_active',
      help: 'Cache backend type: 1=Redis (distributed), 0=Memory (local)',
      type: 'gauge',
    },
  };
}

/**
 * Collect current cache metrics
 * @returns Object with current metric values
 */
export function collectCacheMetrics(): {
  hits: number;
  misses: number;
  errors: number;
  hitRate: number;
  backend: number;
} {
  const cacheMetrics = CacheService.getMetrics();
  const total = cacheMetrics.hits + cacheMetrics.misses;
  const hitRate = total > 0 ? (cacheMetrics.hits / total) * 100 : 0;
  const backend = CacheService.isDistributed() ? 1 : 0;

  return {
    hits: cacheMetrics.hits,
    misses: cacheMetrics.misses,
    errors: cacheMetrics.errors,
    hitRate: parseFloat(hitRate.toFixed(2)),
    backend,
  };
}

/**
 * Format cache metrics for logging
 */
export function formatCacheMetricsLog(): string {
  const metrics = collectCacheMetrics();
  const backend = metrics.backend === 1 ? 'Redis' : 'Memory';

  return (
    `Cache Metrics [${backend}] | ` +
    `Hits: ${metrics.hits} | ` +
    `Misses: ${metrics.misses} | ` +
    `Errors: ${metrics.errors} | ` +
    `Hit Rate: ${metrics.hitRate.toFixed(1)}%`
  );
}

/**
 * Log cache metrics at regular intervals
 * Useful for monitoring cache performance over time
 */
let metricsLoggingInterval: any = null;

export function startCacheMetricsLogging(intervalMs: number = 60000): () => void {
  // Stop any existing interval
  if (metricsLoggingInterval) {
    clearTimeout(metricsLoggingInterval);
  }

  metricsLoggingInterval = setTimeout(
    function tick() {
      logger.info(formatCacheMetricsLog());
      metricsLoggingInterval = setTimeout(tick, intervalMs);
    },
    intervalMs
  );

  return () => {
    if (metricsLoggingInterval) {
      clearTimeout(metricsLoggingInterval);
      metricsLoggingInterval = null;
    }
    logger.debug('Cache metrics logging stopped');
  };
}

/**
 * Cache metrics endpoints for REST API exposure
 */
export const cacheMetricsEndpoints = {
  /**
   * Get current cache metrics as JSON
   */
  getCacheMetrics: () => {
    const metrics = collectCacheMetrics();
    const total = metrics.hits + metrics.misses;
    return {
      summary: {
        totalOperations: total,
        hitRate: `${metrics.hitRate.toFixed(1)}%`,
        backend: metrics.backend === 1 ? 'redis' : 'memory',
      },
      counters: {
        hits: metrics.hits,
        misses: metrics.misses,
        errors: metrics.errors,
      },
    };
  },

  /**
   * Get cache health status
   */
  getCacheHealth: () => {
    const metrics = collectCacheMetrics();
    const backend = CacheService.isDistributed();
    const healthy = metrics.errors < 100; // Simple heuristic: less than 100 errors is healthy

    return {
      status: healthy ? 'healthy' : 'degraded',
      backend: backend ? 'redis' : 'memory',
      metrics: {
        hitRate: metrics.hitRate,
        errorRate: metrics.errors > 0 ? ((metrics.errors / (metrics.hits + metrics.misses + metrics.errors)) * 100).toFixed(2) : '0.00',
      },
      warnings:
        metrics.errors > 50
          ? ['High cache error rate detected']
          : !backend
            ? ['Cache is running in memory-only mode; data will not persist']
            : [],
    };
  },
};
