import { Queue } from "bullmq";
import {
  redisConnection,
  defaultJobOptions,
  QUEUE_NAMES,
} from "./queue.config";

export interface StellarTxJobData {
  /** Base64-encoded signed transaction envelope XDR. */
  txEnvelopeXdr?: string;
  /** ID of the platform user who initiated the transaction. */
  userId: string;
  /** Optional payment record ID to update on confirmation. */
  paymentId?: string;
  /** Free-form metadata stored against the job for audit/debug. */
  metadata?: Record<string, unknown>;
  /** Transaction type for building XDR if not provided. */
  type?: 'payment' | 'refund';
  /** Amount for refund transactions. */
  amount?: string;
  /** Currency for refund transactions. */
  currency?: string;
  /** Description for refund transactions. */
  description?: string;
}

export const stellarTxQueue = new Queue<StellarTxJobData>(
  QUEUE_NAMES.STELLAR_TX,
  {
    connection: redisConnection,
    defaultJobOptions: {
      ...defaultJobOptions,
      // Poll every 15 seconds, up to 40 attempts (~10 minutes total)
      attempts: 40,
      backoff: { type: "fixed", delay: 15_000 },
    },
  },
);

/**
 * Enqueue a Stellar transaction submission job.
 * Uses jobId deduplication — only one active submission per XDR hash.
 */
export async function enqueueStellarTx(
  data: StellarTxJobData,
  jobId?: string,
): Promise<void> {
  await stellarTxQueue.add("submit-stellar-tx", data, {
    jobId: jobId ?? `stellar-tx:${data.paymentId ?? Date.now()}`,
  });
}
