import { Queue, Worker, Job } from 'bullmq';
import { redisConnection, defaultJobOptions, QUEUE_NAMES } from '../config/queue';
import { CDNService } from '../services/cdn.service';
import { db } from '../config/database';
import { Logger } from "../utils/logger.utils";

export interface CDNInvalidationJobData {
  jobType: 'cdn-invalidate';
  paths: string[];
  provider: 'cloudfront' | 'cloudflare' | 'fastly';
  attempt: number;
  invalidationQueueId: string;
}

/**
 * Create CDN invalidation queue for handling failed cache invalidations.
 * These are queued when the invalidate() call fails and retried every 5 minutes.
 */
export const cdnInvalidationQueue = new Queue<CDNInvalidationJobData>(
  QUEUE_NAMES.CDN_INVALIDATION,
  {
    connection: redisConnection,
    defaultJobOptions: {
      ...defaultJobOptions,
      attempts: 288, // 24 hours with 5-minute retries (288 * 5 = 1440 minutes)
      backoff: {
        type: 'fixed',
        delay: 5 * 60 * 1000, // 5 minutes
      },
    },
  },
);

/**
 * Process CDN invalidation jobs from the queue.
 * Each job represents a failed cache invalidation that is being retried.
 */
async function processCDNInvalidationJob(
  job: Job<CDNInvalidationJobData>,
): Promise<void> {
  const { paths, provider, invalidationQueueId, attempt } = job.data;
  const maxAttempts = job.opts.attempts || 288;

  const logData = {
    jobId: job.id,
    invalidationQueueId,
    provider,
    pathCount: paths.length,
    attempt: job.attemptsMade + 1,
    maxAttempts,
  };

  logger.info('CDN invalidation retry job started', logData);

  try {
    // Attempt the invalidation
    const result = await CDNService.invalidate(paths);

    if (!result.success) {
      throw new Error(`Invalidation failed for provider ${provider}`);
    }

    // Mark as successful in the queue table
    await db.query(
      `UPDATE cdn_invalidation_queue 
       SET status = 'completed', updated_at = NOW(), attempt = $1, invalidation_id = $2
       WHERE id = $3`,
      [job.attemptsMade + 1, result.invalidationId || null, invalidationQueueId],
    );

    logger.info('CDN invalidation retry job completed successfully', {
      ...logData,
      invalidationId: result.invalidationId,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const nextAttempt = job.attemptsMade + 1;

    // Update the queue record
    await db.query(
      `UPDATE cdn_invalidation_queue 
       SET status = $1, updated_at = NOW(), attempt = $2, error_message = $3
       WHERE id = $4`,
      [nextAttempt >= maxAttempts ? 'failed' : 'pending', nextAttempt, errorMessage, invalidationQueueId],
    );

    logger.error('CDN invalidation retry job failed', {
      ...logData,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });

    // Re-throw to trigger retry
    throw error;
  }
}

/**
 * Create CDN invalidation worker.
 */
export const cdnInvalidationWorker = new Worker<CDNInvalidationJobData>(
  QUEUE_NAMES.CDN_INVALIDATION,
  processCDNInvalidationJob,
  {
    connection: redisConnection,
    concurrency: 5, // Process up to 5 invalidations concurrently
  },
);

/**
 * Worker event handlers.
 */
cdnInvalidationWorker.on('completed', (job) => {
  logger.info('CDN invalidation worker completed job', {
    jobId: job.id,
    provider: job.data.provider,
    pathCount: job.data.paths.length,
  });
});

cdnInvalidationWorker.on('failed', (job, err) => {
  logger.error('CDN invalidation worker job failed', {
    jobId: job?.id,
    provider: job?.data?.provider,
    pathCount: job?.data?.paths?.length,
    attempt: job?.attemptsMade,
    maxAttempts: job?.opts?.attempts,
    error: err.message,
  });
});

cdnInvalidationWorker.on('error', (err) => {
  logger.error('CDN invalidation worker error', {
    error: err.message,
    stack: err.stack,
  });
});

/**
 * Graceful shutdown.
 */
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, closing CDN invalidation worker...');
  await cdnInvalidationWorker.close();
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, closing CDN invalidation worker...');
  await cdnInvalidationWorker.close();
});

/**
 * Enqueue a failed CDN invalidation for retry.
 * This is called when CDNService.invalidate() fails.
 */
export async function enqueueCDNInvalidation(
  paths: string[],
  provider: 'cloudfront' | 'cloudflare' | 'fastly',
): Promise<string> {
  try {
    // Insert into cdn_invalidation_queue table
    const result = await db.query(
      `INSERT INTO cdn_invalidation_queue (paths, provider, status, attempt, created_at, updated_at)
       VALUES ($1, $2, 'pending', 0, NOW(), NOW())
       RETURNING id`,
      [JSON.stringify(paths), provider],
    );

    const invalidationQueueId = result.rows[0].id;

    // Add to BullMQ queue for background processing
    const job = await cdnInvalidationQueue.add(
      'cdn-invalidate',
      {
        jobType: 'cdn-invalidate',
        paths,
        provider,
        attempt: 0,
        invalidationQueueId,
      },
      {
        jobId: `cdn-invalidation-${invalidationQueueId}`,
        priority: 10, // High priority
      },
    );

    logger.info('CDN invalidation enqueued for retry', {
      invalidationQueueId,
      provider,
      pathCount: paths.length,
      jobId: job.id,
    });

    return invalidationQueueId;
  } catch (error) {
    logger.error('Failed to enqueue CDN invalidation', {
      provider,
      pathCount: paths.length,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

/**
 * Get statistics on the CDN invalidation queue.
 */
export async function getCDNInvalidationQueueStats() {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    cdnInvalidationQueue.getWaitingCount(),
    cdnInvalidationQueue.getActiveCount(),
    cdnInvalidationQueue.getCompletedCount(),
    cdnInvalidationQueue.getFailedCount(),
    cdnInvalidationQueue.getDelayedCount(),
  ]);

  // Get stats from database
  const dbStats = await db.query(`
    SELECT 
      status,
      COUNT(*) as count
    FROM cdn_invalidation_queue
    WHERE created_at > NOW() - INTERVAL '24 hours'
    GROUP BY status
  `);

  const statsByStatus: Record<string, number> = {};
  for (const row of dbStats.rows) {
    statsByStatus[row.status] = row.count;
  }

  return {
    queue: {
      waiting,
      active,
      completed,
      failed,
      delayed,
      total: waiting + active + completed + failed + delayed,
    },
    database: statsByStatus,
  };
}

/**
 * Clean old jobs from the queue.
 */
export async function cleanCDNInvalidationQueue(
  gracePeriodMs: number = 24 * 60 * 60 * 1000, // 24 hours
): Promise<void> {
  await cdnInvalidationQueue.clean(gracePeriodMs, 100, 'completed');
  await cdnInvalidationQueue.clean(gracePeriodMs, 100, 'failed');

  logger.info('CDN invalidation queue cleaned', { gracePeriodMs });
}

export default {
  cdnInvalidationQueue,
  cdnInvalidationWorker,
  enqueueCDNInvalidation,
  getCDNInvalidationQueueStats,
  cleanCDNInvalidationQueue,
};
