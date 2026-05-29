import { Queue } from 'bullmq';
import {
  redisConnection,
  defaultJobOptions,
  QUEUE_NAMES,
} from './queue.config';

export interface PaymentPollJobData {
  paymentId: string;
  userId: string;
  transactionHash: string | null;
}

export const paymentPollQueue = new Queue<PaymentPollJobData>(
  QUEUE_NAMES.PAYMENT_POLL,
  {
    connection: redisConnection,
    defaultJobOptions: {
      ...defaultJobOptions,
      // Poll every 30 seconds, up to 20 attempts (10 minutes total)
      attempts: 20,
      backoff: { type: 'fixed', delay: 30_000 },
    },
  },
);

/**
 * Enqueue a payment status poll job.
 * The worker will check the Stellar network for the transaction status.
 */
export async function enqueuePaymentPoll(
  data: PaymentPollJobData,
): Promise<void> {
  // Deduplicate by paymentId — only one active poll per payment
  await paymentPollQueue.add('poll-payment', data, {
    jobId: `payment-poll:${data.paymentId}`,
  });
}
