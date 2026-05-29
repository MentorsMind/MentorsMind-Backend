import { Queue } from 'bullmq';
import {
  redisConnection,
  defaultJobOptions,
  QUEUE_NAMES,
} from './queue.config';
import type { EmailRequest } from '../services/email.service';

export interface EmailJobData extends EmailRequest {
  jobType: 'send-email';
  requestId?: string;
  correlationId?: string;
}

export const emailQueue = new Queue<EmailJobData>(QUEUE_NAMES.EMAIL, {
  connection: redisConnection,
  defaultJobOptions,
});

import { traceStore } from '../middleware/tracing.middleware';

/**
 * Enqueue an email send job.
 * @param data - Email request payload
 * @param priority - Optional BullMQ priority (lower = higher priority)
 */
export async function enqueueEmail(
  data: EmailRequest,
  priority?: number,
): Promise<void> {
  const context = traceStore.getStore();
  await emailQueue.add(
    'send-email',
    { 
      ...data, 
      jobType: 'send-email',
      requestId: context?.requestId,
      correlationId: context?.correlationId,
    },
    { priority },
  );
}
