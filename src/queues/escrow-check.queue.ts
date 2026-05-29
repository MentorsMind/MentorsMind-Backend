import { Queue } from "bullmq";
import {
  redisConnection,
  defaultJobOptions,
  QUEUE_NAMES,
} from "./queue.config";

/**
 * Payload for the hourly escrow eligibility scan (cron trigger).
 * The worker uses this as a tombstone — actual escrow IDs are fetched
 * from the database at runtime.
 */
export interface EscrowCheckJobData {
  jobType: "escrow-check-cron";
  /** ISO timestamp — set by the scheduler so workers can log timing drift. */
  triggeredAt: string;
}

export const escrowCheckQueue = new Queue<EscrowCheckJobData>(
  QUEUE_NAMES.ESCROW_CHECK,
  {
    connection: redisConnection,
    defaultJobOptions: {
      ...defaultJobOptions,
      attempts: 1, // cron jobs should not auto-retry; failures are logged
      removeOnComplete: { count: 50 },
    },
  },
);
