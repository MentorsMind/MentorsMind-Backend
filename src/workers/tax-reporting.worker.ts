import { Worker, Job } from 'bullmq';
import { redisConnection, QUEUE_NAMES } from '../queues/queue.config';
import { runYearlyTaxReportingJob } from '../jobs/yearlyTaxReporting.job';
import { logger } from '../utils/logger.utils';
import type { TaxReportingJobData } from '../queues/tax-reporting.queue';

async function processTaxReportingJob(job: Job<TaxReportingJobData>): Promise<void> {
  logger.info('[TaxReportingWorker] Running tax reporting job', { jobId: job.id, taxYear: job.data.taxYear });
  const result = await runYearlyTaxReportingJob(job.data.taxYear);
  job.updateProgress(100);
  return result as any;
}

export const taxReportingWorker = new Worker<TaxReportingJobData>(
  QUEUE_NAMES.TAX_REPORTING,
  processTaxReportingJob,
  { connection: redisConnection, concurrency: 1 },
);

taxReportingWorker.on('completed', (job) => {
  logger.info('[TaxReportingWorker] Job completed', { jobId: job.id });
});

taxReportingWorker.on('failed', (job, err) => {
  logger.error('[TaxReportingWorker] Job failed', {
    jobId: job?.id,
    attempt: job?.attemptsMade,
    error: err.message,
  });
});

taxReportingWorker.on('error', (err) => {
  logger.error('[TaxReportingWorker] Worker error', { error: err.message });
});
