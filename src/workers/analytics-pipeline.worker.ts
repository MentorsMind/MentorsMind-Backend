import { Worker, Job } from 'bullmq';
import { queueConnection } from '../queues/queue.config';
import { logger } from '../utils/logger';
import { AdvancedAnalyticsService } from '../services/advanced-analytics.service';
import { CacheService } from '../services/cache.service';
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
    removeOnComplete: 100, // Keep last 100 completed jobs
    removeOnFail: 50, // Keep last 50 failed jobs
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
    await CacheService.set(metricKey, parseInt(currentCount) + 1, 3600); // 1 hour TTL
  } catch (error) {
    // Don't fail the job if metrics update fails
    logger.warn('Failed to update processing metrics', { error, table, operation });
  }
}

// Scheduled jobs for analytics maintenance
export const AnalyticsScheduledJobs = {
  // Refresh materialized views every 15 minutes
  refreshViews: {
    schedule: '*/15 * * * *',
    handler: async () => {
      try {
        logger.info('Starting scheduled analytics views refresh');
        await AdvancedAnalyticsService.refreshAnalytics();
        await CacheInvalidationService.onViewsRefreshed();
        logger.info('Scheduled analytics views refresh completed');
      } catch (error) {
        logger.error('Scheduled analytics views refresh failed', { error });
        throw error;
      }
    }
  },
  
  // Clean up old analytics data daily at 2 AM
  cleanupOldData: {
    schedule: '0 2 * * *',
    handler: async () => {
      try {
        logger.info('Starting analytics data cleanup');
        
        // Clean up old insights (older than 90 days)
        await pool.query(`
          DELETE FROM analytics_insights 
          WHERE created_at < CURRENT_DATE - INTERVAL '90 days'
        `);
        
        // Clean up old predictions (older than 30 days)
        await pool.query(`
          DELETE FROM analytics_predictions 
          WHERE created_at < CURRENT_DATE - INTERVAL '30 days'
        `);
        
        logger.info('Analytics data cleanup completed');
      } catch (error) {
        logger.error('Analytics data cleanup failed', { error });
        throw error;
      }
    }
  },
  
  // Update processing health metrics every 5 minutes
  updateHealthMetrics: {
    schedule: '*/5 * * * *',
    handler: async () => {
      try {
        // Check pipeline health
        const healthMetrics = await getAnalyticsPipelineHealth();
        await CacheService.set('analytics:health', healthMetrics, 300); // 5 minutes TTL
        
        // Alert if processing is behind
        if (healthMetrics.processingLag > 300) { // 5 minutes
          logger.warn('Analytics pipeline processing lag detected', { 
            lag: healthMetrics.processingLag 
          });
        }
      } catch (error) {
        logger.error('Failed to update analytics health metrics', { error });
      }
    }
  }
};

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
      error: error.message,
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
            removeOnComplete: 100,
            removeOnFail: 50,
          });
          
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