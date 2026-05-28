import { logger } from "./utils/logger";
import { AdvancedAnalyticsService } from "./services/advanced-analytics.service";
import { initializeAnalyticsPipeline } from "./workers/analytics-pipeline.worker";

/**
 * Initialize Advanced Analytics Dashboard
 * Call this during application startup
 */
export async function initializeAdvancedAnalytics(): Promise<void> {
  try {
    logger.info('Initializing Advanced Analytics Dashboard...');
    
    // Initialize core analytics service
    await AdvancedAnalyticsService.initialize();
    
    // Initialize real-time pipeline
    await initializeAnalyticsPipeline();
    
    // Schedule background jobs (if using a job scheduler)
    await scheduleAnalyticsJobs();
    
    logger.info('Advanced Analytics Dashboard initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize Advanced Analytics Dashboard', { error });
    throw error;
  }
}

/**
 * Schedule analytics background jobs
 */
async function scheduleAnalyticsJobs(): Promise<void> {
  try {
    const { Queue } = await import('bullmq');
    const { queueConnection } = await import('./queues/queue.config');
    
    // Create analytics jobs queue
    const analyticsJobsQueue = new Queue('analytics-jobs', { connection: queueConnection });
    
    // Schedule materialized view refresh every 15 minutes
    await analyticsJobsQueue.add(
      'refresh-views',
      {},
      {
        repeat: { pattern: '*/15 * * * *' }, // Every 15 minutes
        removeOnComplete: 5,
        removeOnFail: 3
      }
    );
    
    // Schedule prediction model training daily at 2 AM
    await analyticsJobsQueue.add(
      'train-models',
      {},
      {
        repeat: { pattern: '0 2 * * *' }, // Daily at 2 AM
        removeOnComplete: 5,
        removeOnFail: 3
      }
    );
    
    // Schedule insight generation daily at 4 AM
    await analyticsJobsQueue.add(
      'generate-insights',
      {},
      {
        repeat: { pattern: '0 4 * * *' }, // Daily at 4 AM
        removeOnComplete: 5,
        removeOnFail: 3
      }
    );
    
    logger.info('Analytics background jobs scheduled successfully');
  } catch (error) {
    logger.error('Failed to schedule analytics jobs', { error });
    // Don't throw - jobs are optional
  }
}

/**
 * Health check for analytics system
 */
export async function checkAnalyticsHealth(): Promise<{
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: Record<string, boolean>;
  lastUpdated: string;
}> {
  const checks = {
    database: false,
    cache: false,
    materializedViews: false,
    pipeline: false
  };
  
  try {
    // Check database connection
    const { AnalyticsService } = await import('./services/analytics.service');
    checks.database = await AnalyticsService.checkViewsExist();
    
    // Check cache
    const { CacheService } = await import('./services/cache.service');
    const testKey = 'analytics:health:test';
    await CacheService.set(testKey, 'ok', 10);
    const testValue = await CacheService.get(testKey);
    checks.cache = testValue === 'ok';
    
    // Check materialized views
    checks.materializedViews = checks.database;
    
    // Check pipeline health
    const pipelineHealth = await CacheService.get('analytics:health');
    checks.pipeline = !!pipelineHealth && !pipelineHealth.error;
    
  } catch (error) {
    logger.error('Analytics health check failed', { error });
  }
  
  const healthyCount = Object.values(checks).filter(Boolean).length;
  const totalChecks = Object.keys(checks).length;
  
  let status: 'healthy' | 'degraded' | 'unhealthy';
  if (healthyCount === totalChecks) {
    status = 'healthy';
  } else if (healthyCount >= totalChecks / 2) {
    status = 'degraded';
  } else {
    status = 'unhealthy';
  }
  
  return {
    status,
    checks,
    lastUpdated: new Date().toISOString()
  };
}