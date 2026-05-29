import { Worker, Job } from 'bullmq';
import { redisConnection, CONCURRENCY, QUEUE_NAMES } from '../queues/queue.config';
import { runSessionReminderJob } from '../jobs/sessionReminder.job';
import { logger } from '../utils/logger.utils';
import type { SessionReminderJobData } from '../queues/sessionReminder.queue';

async function processSessionReminderJob(job: Job<SessionReminderJobData>): Promise<void> {
    logger.info('[SessionReminderWorker] Running session reminder job', { jobId: job.id });
    await runSessionReminderJob();
}

export const sessionReminderWorker = new Worker<SessionReminderJobData>(
    QUEUE_NAMES.SESSION_REMINDER,
    processSessionReminderJob,
    { connection: redisConnection, concurrency: CONCURRENCY.SESSION_REMINDER },
);

sessionReminderWorker.on('completed', (job) => {
    logger.info('[SessionReminderWorker] Job completed', { jobId: job.id });
});

sessionReminderWorker.on('failed', (job, err) => {
    logger.error('[SessionReminderWorker] Job failed', {
        jobId: job?.id,
        attempt: job?.attemptsMade,
        error: err.message,
    });
});

sessionReminderWorker.on('error', (err) => {
    logger.error('[SessionReminderWorker] Worker error', { error: err.message });
});
