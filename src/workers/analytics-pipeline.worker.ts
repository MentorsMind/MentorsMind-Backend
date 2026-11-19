/**
 * Analytics Pipeline Worker
 *
 * Processes domain events (INSERT/UPDATE/DELETE on core tables) forwarded from
 * PostgreSQL LISTEN/NOTIFY. Responsibilities:
 *  - Update Redis counters / invalidate view-scoped cache keys
 *  - Track processing metrics
 *
 * This worker does NOT refresh materialized views directly.
 * View refreshes are handled exclusively by analyticsRefresh.worker.ts via
 * the analyticsRefreshQueue, coordinated by refreshAnalytics.job.ts.
 */

import { Worker, Job } from 'bullmq';
import { queueConnection } from '../queues/queue.config';
import { logger } from '../utils/logger.utils';
import { CacheService } from '../services/cache.service';
import { RealtimeAnalyticsService } from '../services/realtime-analytics.service';
import pool from '../config/database';

// Analytics event types
interface AnalyticsEvent {
  table: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  id: string;
  timestamp: string;
  data?: any;
}

// Cache invalidation service
export const CacheInvalidationService = {
  // Invalidate on transaction completion
  onTransactionCompleted: async (transaction: any) => {
    await CacheService.invalidate('analytics:revenue:*');
    await CacheService.invalidate('analytics:dashboard:*');
    await CacheService.invalidate('analytics:metrics:revenue:*');
    logger.debug('Cache invalidated for transaction completion', { transactionId: transaction.id });
  },
  
  // Invalidate on booking status change
  onBookingStatusChanged: async (booking: any) => {
    await CacheService.invalidate('analytics:sessions:*');
    await CacheService.invalidate('analytics:dashboard:*');
    await CacheService.invalidate('analytics:metrics:sessions:*');
    logger.debug('Cache invalidated for booking status change', { bookingId: booking.id });
  },
  
  // Invalidate on user registration
  onUserRegistered: async (user: any) => {
    await CacheService.invalidate('analytics:users:*');
    await CacheService.invalidate('analytics:cohorts:*');
    await CacheService.invalidate('analytics:dashboard:*');
    logger.debug('Cache invalidated for user registration', { userId: user.id });
  },
  
  // Invalidate on review creation
  onReviewCreated: async (review: any) => {
    await CacheService.invalidate('analytics:mentors:*');
    await CacheService.invalidate('analytics:dashboard:*');
    logger.debug('Cache invalidated for review creation', { reviewId: review.id });
  },
  
  // Invalidate on materialized view refresh
  onViewsRefreshed: async () => {
    await CacheService.invalidate('analytics:*');
    // Also flush realtime caches so the next read goes back to base-table queries
    await RealtimeAnalyticsService.invalidateRealtimeCache('all').catch((err) =>
      logger.warn('RealtimeAnalytics: failed to flush realtime cache on view refresh', { err }),
    );
    logger.info('All analytics cache invalidated after view refresh');
  },
};

// Analytics pipeline worker
export const AnalyticsPipelineWorker = new Worker(
  'analytics-events',
  async (job: Job<AnalyticsEvent>) => {
    const { table, operation, id, timestamp } = job.data;
    
    try {
      logger.debug('Processing analytics event', { table, operation, id, timestamp });
      
      // Process different table events
      switch (table) {
        case 'transactions':
          await processTransactionEvent(operation, id);
          break;
        case 'bookings':
          await processBookingEvent(operation, id);
          break;
        case 'users':
          await processUserEvent(operation, id);
          break;
        case 'reviews':
          await processReviewEvent(operation, id);
          break;
        default:
          logger.warn('Unknown table in analytics event', { table });
      }
      
      // Update processing metrics
      await updateProcessingMetrics(table, operation);
      
    } catch (error) {
      logger.error('Failed to process analytics event', { 
        error, 
        table, 
        operation, 
        id,
        jobId: job.id 
      });
      throw error;
    }
  },
  {
    connection: queueConnection,
    concurrency: 5, // Process up to 5 events concurrently
    removeOnComplete: { count: 100 }, // Keep last 100 completed jobs
    removeOnFail: { count: 50 }, // Keep last 50 failed jobs
  }
);

// Process transaction events
async function processTransactionEvent(operation: string, id: string): Promise<void> {
  if (operation === 'INSERT' || operation === 'UPDATE') {
    // Get transaction details
    const { rows } = await pool.query(
      'SELECT * FROM transactions WHERE id = $1',
      [id]
    );
    
    if (rows.length > 0) {
      const transaction = rows[0];
      
      // If transaction completed, invalidate revenue caches
      if (transaction.status === 'completed') {
        await CacheInvalidationService.onTransactionCompleted(transaction);
      }

      // Push incremental realtime aggregate to Redis
      await RealtimeAnalyticsService.updateRealtimeRevenueAggregate(id).catch((err) =>
        logger.warn('RealtimeAnalytics: failed to update revenue aggregate', { err, id }),
      );
    }
  }
}

// Process booking events
async function processBookingEvent(operation: string, id: string): Promise<void> {
  if (operation === 'INSERT' || operation === 'UPDATE') {
    // Get booking details
    const { rows } = await pool.query(
      'SELECT * FROM bookings WHERE id = $1',
      [id]
    );
    
    if (rows.length > 0) {
      const booking = rows[0];
      await CacheInvalidationService.onBookingStatusChanged(booking);
    }

    // Push incremental realtime session aggregate to Redis
    await RealtimeAnalyticsService.updateRealtimeSessionAggregate(id).catch((err) =>
      logger.warn('RealtimeAnalytics: failed to update session aggregate', { err, id }),
    );
  }
}

// Process user events
async function processUserEvent(operation: string, id: string): Promise<void> {
  if (operation === 'INSERT') {
    // Get user details
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [id]
    );
    
    if (rows.length > 0) {
      const user = rows[0];
      await CacheInvalidationService.onUserRegistered(user);
    }

    // Push incremental realtime user growth aggregate to Redis
    await RealtimeAnalyticsService.updateRealtimeUserAggregate(id).catch((err) =>
      logger.warn('RealtimeAnalytics: failed to update user aggregate', { err, id }),
    );
  }
}

// Process review events
async function processReviewEvent(operation: string, id: string): Promise<void> {
  if (operation === 'INSERT') {
    // Get review details
    const { rows } = await pool.query(
      'SELECT * FROM reviews WHERE id = $1',
      [id]
    );
    
    if (rows.length > 0) {
      const review = rows[0];
      await CacheInvalidationService.onReviewCreated(review);
    }
  }
}
// Update processing metrics
async function updateProcessingMetrics(table: string, operation: string): Promise<void> {
  try {
    // Simple metrics tracking - could be enhanced with Prometheus/StatsD
    const metricKey = `analytics:processing:${table}:${operation}`;
    const currentCount = await CacheService.get(metricKey) || 0;
    await CacheService.set(metricKey, Number(currentCount) + 1, 3600); // 1 hour TTL
  } catch (error) {
    // Don't fail the job if metrics update fails
    logger.warn('Failed to update processing metrics', { error, table, operation });
  }
}

// Get analytics pipeline health metrics
async function getAnalyticsPipelineHealth(): Promise<any> {
  try {
    // Get queue stats (this would need to be implemented based on your queue monitoring)
    const queueStats = {
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0
    };
    
    // Calculate processing lag
    const lastProcessedQuery = `
      SELECT MAX(created_at) as last_processed
      FROM analytics_insights
      WHERE created_at > CURRENT_TIMESTAMP - INTERVAL '1 hour'
    `;
    
    const { rows } = await pool.query(lastProcessedQuery);
    const lastProcessed = rows[0]?.last_processed;
    const processingLag = lastProcessed 
      ? Math.floor((Date.now() - new Date(lastProcessed).getTime()) / 1000)
      : 0;
    
    return {
      ...queueStats,
      processingLag,
      lastHealthCheck: new Date().toISOString()
    };
  } catch (error) {
    logger.error('Failed to get analytics pipeline health', { error });
    return {
      error: (error as Error).message,
      lastHealthCheck: new Date().toISOString()
    };
  }
}

// PostgreSQL LISTEN/NOTIFY handler for real-time events
export class AnalyticsEventListener {
  private client: any;
  private isListening = false;

  async start(): Promise<void> {
    if (this.isListening) return;

    try {
      // Create dedicated connection for LISTEN
      this.client = await pool.connect();
      
      // Listen for analytics events
      await this.client.query('LISTEN analytics_event');
      
      // Handle notifications
      this.client.on('notification', async (msg: any) => {
        try {
          const event: AnalyticsEvent = JSON.parse(msg.payload);
          
          // Add to processing queue
          const { Queue } = await import('bullmq');
          const analyticsQueue = new Queue('analytics-events', { connection: queueConnection });
          
          await analyticsQueue.add('process-event', event, {
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 2000,
            },
            removeOnComplete: { count: 100 },
            removeOnFail: { count: 50 },
          });

          // Invalidate realtime cache for this table so next read is fresh
          await RealtimeAnalyticsService.invalidateRealtimeCache(event.table).catch((err) =>
            logger.warn('RealtimeAnalytics: failed to invalidate cache on notification', {
              err,
              table: event.table,
            }),
          );
          
          logger.debug('Analytics event queued for processing', { 
            table: event.table, 
            operation: event.operation 
          });
        } catch (error) {
          logger.error('Failed to process analytics notification', { error, payload: msg.payload });
        }
      });
      
      this.isListening = true;
      logger.info('Analytics event listener started');
    } catch (error) {
      logger.error('Failed to start analytics event listener', { error });
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isListening || !this.client) return;

    try {
      await this.client.query('UNLISTEN analytics_event');
      this.client.release();
      this.isListening = false;
      logger.info('Analytics event listener stopped');
    } catch (error) {
      logger.error('Failed to stop analytics event listener', { error });
    }
  }
}

// Worker event handlers
AnalyticsPipelineWorker.on('completed', (job) => {
  logger.debug('Analytics event processed successfully', { 
    jobId: job.id,
    processingTime: job.processedOn ? job.finishedOn! - job.processedOn : 0
  });
});

AnalyticsPipelineWorker.on('failed', (job, err) => {
  logger.error('Analytics event processing failed', { 
    jobId: job?.id,
    error: err.message,
    data: job?.data
  });
});

AnalyticsPipelineWorker.on('error', (err) => {
  logger.error('Analytics pipeline worker error', { error: err });
});

// Export for initialization
export const initializeAnalyticsPipeline = async (): Promise<void> => {
  try {
    // Start event listener
    const eventListener = new AnalyticsEventListener();
    await eventListener.start();
    
    logger.info('Analytics pipeline initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize analytics pipeline', { error });
    throw error;
  }
};
