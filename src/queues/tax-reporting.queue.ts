import { Queue } from 'bullmq';
import { redisConnection, defaultJobOptions, QUEUE_NAMES } from './queue.config';

export interface TaxReportingJobData {
  jobType: 'tax-reporting';
  taxYear?: number;
  mentorId?: string;
  triggeredAt?: string;
}

export const taxReportingQueue = new Queue<TaxReportingJobData>(
  QUEUE_NAMES.TAX_REPORTING,
  { connection: redisConnection, defaultJobOptions },
);
