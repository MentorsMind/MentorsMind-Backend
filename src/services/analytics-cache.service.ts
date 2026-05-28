import { CacheService } from "./cache.service";
import { logger } from "../utils/logger";

// Cache configuration for analytics
export const ANALYTICS_CACHE_CONFIG = {
  // Dashboard data - 3 minutes (frequent updates)
  'analytics:dashboard:{userId}:{period}': 180,
  
  // Revenue data - 5 minutes
  'analytics:revenue:{period}': 300,
  'analytics:revenue:{currency}:{period}': 300,
  
  // Session data - 5 minutes
  'analytics:sessions:{period}': 300,
  'analytics:sessions:{status}:{period}': 300,
  
  // User data - 10 minutes (less frequent changes)
  'analytics:users:{period}': 600,
  'analytics:users:{role}:{period}': 600,
  
  // Predictions - 24 hours (updated daily)
  'analytics:predictions:revenue:{currency}': 86400,
  'analytics:predictions:demand': 86400,
  'analytics:predictions:accuracy': 86400,
  
  // Cohort data - 1 hour
  'analytics:cohorts:{type}:{role}': 3600,
  'analytics:cohorts:{cohortId}:details': 3600,
  
  // Custom report data - 10 minutes
  'analytics:report:{reportId}': 600,
  'analytics:report:{reportId}:data': 600,
  
  // Insights - 15 minutes
  'analytics:insights:{userId}': 900,
  'analytics:insights:unread:{userId}': 300,
  
  // Available fields metadata - 1 hour
  'analytics:fields:metadata': 3600,
  'analytics:fields:metrics': 3600,
  'analytics:fields:dimensions': 3600,
  
  // Export data - 30 minutes
  'analytics:export:{type}:{format}': 1800,
  
  // Health metrics - 5 minutes
  'analytics:health': 300,
  'analytics:processing:{table}:{operation}': 3600,
  
  // Materialized view status - 1 minute
  'analytics:views:status': 60,
  'analytics:views:last_refresh': 60,
};

export interface CacheWarmingConfig {
  key: string;
  generator: () => Promise<any>;
  priority: 'high' | 'medium' | 'low';
  dependencies?: string[];
}

export const AnalyticsCacheService = {
  /**
   * Get cache TTL for a specific key pattern
   */
  getTTL(keyPattern: string): number {
    // Find matching pattern
    for (const [pattern, ttl] of Object.entries(ANALYTICS_CACHE_CONFIG)) {
      if (this.matchesPattern(keyPattern, pattern)) {
        return ttl;
      }
    }
    
    // Default TTL for analytics data
    return 300; // 5 minutes
  },

  /**
   * Check if key matches pattern
   */
  matchesPattern(key: string, pattern: string): boolean {
    // Convert pattern to regex (replace {param} with .+)
    const regexPattern = pattern.replace(/\{[^}]+\}/g, '.+');
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(key);
  },

  /**
   * Intelligent cache warming for frequently accessed data
   */
  async warmCache(configs: CacheWarmingConfig[]): Promise<void> {
    logger.info('Starting analytics cache warming', { configCount: configs.length });
    
    // Sort by priority
    const sortedConfigs = configs.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
    
    const results = {
      success: 0,
      failed: 0,
      skipped: 0
    };
    
    for (const config of sortedConfigs) {
      try {
        // Check if already cached
        const existing = await CacheService.get(config.key);
        if (existing) {
          results.skipped++;
          continue;
        }
        
        // Check dependencies
        if (config.dependencies) {
          const dependenciesMet = await this.checkDependencies(config.dependencies);
          if (!dependenciesMet) {
            logger.debug('Cache warming skipped due to unmet dependencies', { 
              key: config.key,
              dependencies: config.dependencies 
            });
            results.skipped++;
            continue;
          }
        }
        
        // Generate and cache data
        const data = await config.generator();
        const ttl = this.getTTL(config.key);
        await CacheService.set(config.key, data, ttl);
        
        results.success++;
        logger.debug('Cache warmed successfully', { key: config.key });
      } catch (error) {
        results.failed++;
        logger.warn('Cache warming failed', { key: config.key, error: error.message });
      }
    }
    
    logger.info('Analytics cache warming completed', results);
  },

  /**
   * Check if cache dependencies are met
   */
  async checkDependencies(dependencies: string[]): Promise<boolean> {
    for (const dep of dependencies) {
      const exists = await CacheService.get(dep);
      if (!exists) return false;
    }
    return true;
  },

  /**
   * Invalidate cache with pattern matching
   */
  async invalidatePattern(pattern: string): Promise<void> {
    try {
      await CacheService.invalidate(pattern);
      logger.debug('Cache pattern invalidated', { pattern });
    } catch (error) {
      logger.error('Failed to invalidate cache pattern', { pattern, error });
    }
  },

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<any> {
    try {
      // This would need to be implemented based on your Redis setup
      // For now, return basic stats
      const stats = {
        totalKeys: 0,
        analyticsKeys: 0,
        hitRate: 0,
        memoryUsage: 0,
        lastUpdated: new Date().toISOString()
      };
      
      return stats;
    } catch (error) {
      logger.error('Failed to get cache stats', { error });
      return null;
    }
  },

  /**
   * Compress large cache values
   */
  async setCompressed(key: string, data: any, ttl?: number): Promise<void> {
    try {
      // For large objects, compress before caching
      const serialized = JSON.stringify(data);
      
      if (serialized.length > 10000) { // 10KB threshold
        // In a real implementation, you'd use compression library like zlib
        logger.debug('Large cache value detected, compression recommended', { 
          key, 
          size: serialized.length 
        });
      }
      
      const cacheTTL = ttl || this.getTTL(key);
      await CacheService.set(key, data, cacheTTL);
    } catch (error) {
      logger.error('Failed to set compressed cache value', { key, error });
      throw error;
    }
  },

  /**
   * Batch cache operations
   */
  async setBatch(operations: Array<{ key: string; data: any; ttl?: number }>): Promise<void> {
    const results = {
      success: 0,
      failed: 0
    };
    
    for (const op of operations) {
      try {
        await this.setCompressed(op.key, op.data, op.ttl);
        results.success++;
      } catch (error) {
        results.failed++;
        logger.warn('Batch cache operation failed', { key: op.key, error: error.message });
      }
    }
    
    logger.debug('Batch cache operations completed', results);
  },

  /**
   * Cache with fallback strategy
   */
  async getWithFallback<T>(
    key: string, 
    generator: () => Promise<T>, 
    fallbackGenerator?: () => Promise<T>
  ): Promise<T> {
    try {
      // Try cache first
      const cached = await CacheService.get(key);
      if (cached) return cached;
      
      // Try primary generator
      try {
        const data = await generator();
        const ttl = this.getTTL(key);
        await CacheService.set(key, data, ttl);
        return data;
      } catch (primaryError) {
        logger.warn('Primary data generator failed, trying fallback', { 
          key, 
          error: primaryError.message 
        });
        
        // Try fallback generator if available
        if (fallbackGenerator) {
          const fallbackData = await fallbackGenerator();
          // Cache fallback data with shorter TTL
          await CacheService.set(key, fallbackData, 60); // 1 minute
          return fallbackData;
        }
        
        throw primaryError;
      }
    } catch (error) {
      logger.error('Cache with fallback failed', { key, error });
      throw error;
    }
  },

  /**
   * Preload cache for common dashboard queries
   */
  async preloadDashboardCache(userId: string): Promise<void> {
    const periods = ['7d', '30d', '90d'];
    const warmingConfigs: CacheWarmingConfig[] = [];
    
    for (const period of periods) {
      warmingConfigs.push({
        key: `analytics:dashboard:${userId}:${period}`,
        generator: async () => {
          const { AdvancedAnalyticsService } = await import('./advanced-analytics.service');
          return AdvancedAnalyticsService.getDashboard(userId, period);
        },
        priority: period === '30d' ? 'high' : 'medium'
      });
    }
    
    await this.warmCache(warmingConfigs);
  },

  /**
   * Monitor cache performance
   */
  async monitorCachePerformance(): Promise<void> {
    try {
      const stats = await this.getCacheStats();
      
      if (stats) {
        // Log performance metrics
        logger.info('Analytics cache performance', stats);
        
        // Alert if hit rate is low
        if (stats.hitRate < 0.8) {
          logger.warn('Analytics cache hit rate below threshold', { 
            hitRate: stats.hitRate,
            threshold: 0.8 
          });
        }
        
        // Store performance metrics
        await CacheService.set('analytics:cache:performance', stats, 300);
      }
    } catch (error) {
      logger.error('Failed to monitor cache performance', { error });
    }
  }
};