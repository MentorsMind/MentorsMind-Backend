import type { Job, Worker } from 'bullmq';
import * as Sentry from '@sentry/node';
import { logger } from '../utils/logger.utils';
import { workerJobsFailedTotal } from '../config/metrics';

export function registerWorkerLifecycleLogging(worker: Worker): Worker {
    let jobsCompleted = 0;

    worker.on('completed', () => {
        jobsCompleted += 1;
    });

    worker.on('ready', () => {
        logger.info({
            queueName: worker.name,
            concurrency: worker.opts.concurrency,
            workerId: worker.id,
            timestamp: new Date().toISOString(),
        }, 'Worker ready');
    });

    worker.on('closed', () => {
        logger.info({
            queueName: worker.name,
            jobsCompleted,
            timestamp: new Date().toISOString(),
        }, 'Worker closed');
    });

    // job is undefined when BullMQ emits `failed` without a job (e.g. stalled-job/connection errors)
    worker.on('failed', (job: Job | undefined, error: Error) => {
        const attemptsMade = job?.attemptsMade;
        logger.error({
            queueName: worker.name,
            jobId: job?.id,
            jobName: job?.name,
            attemptsMade,
            err: error,
            timestamp: new Date().toISOString(),
        }, `Worker job failed: ${error?.message}`);

        Sentry.captureException(error, {
            extra: { jobId: job?.id, queueName: worker.name, attemptsMade },
        });

        workerJobsFailedTotal.inc({ queue: worker.name });
    });

    worker.on('error', (error) => {
        logger.error({
            queueName: worker.name,
            workerId: worker.id,
            err: error,
            timestamp: new Date().toISOString(),
        }, 'Worker error');
    });

    return worker;
}
