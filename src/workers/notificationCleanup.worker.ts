import { Worker, Job } from 'bullmq';
import { redisConnection, QUEUE_NAMES } from '../queues/queue.config';
import { NotificationCleanupJobData } from '../queues/notificationCleanup.queue';
import { runNotificationCleanupJob } from '../jobs/notificationCleanup.job';
import { logger } from '../utils/logger.utils';

async function processNotificationCleanupJob(
  job: Job<NotificationCleanupJobData>,
): Promise<void> {
  logger.info('[NotificationCleanupWorker] Running cleanup job', { jobId: job.id });
  await runNotificationCleanupJob();
}

export const notificationCleanupWorker = new Worker<NotificationCleanupJobData>(
  QUEUE_NAMES.NOTIFICATION_CLEANUP,
  processNotificationCleanupJob,
  { connection: redisConnection, concurrency: 1 },
);

notificationCleanupWorker.on('completed', (job) => {
  logger.info('[NotificationCleanupWorker] Job completed', { jobId: job.id });
});

notificationCleanupWorker.on('failed', (job, err) => {
  logger.error('[NotificationCleanupWorker] Job failed', {
    jobId: job?.id,
    attempt: job?.attemptsMade,
    error: err.message,
  });
});

notificationCleanupWorker.on('error', (err) => {
  logger.error('[NotificationCleanupWorker] Worker error', { error: err.message });
});
