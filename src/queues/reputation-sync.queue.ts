import { Queue } from 'bullmq';
import {
  redisConnection,
  defaultJobOptions,
  QUEUE_NAMES,
} from './queue.config';

export interface ReputationSyncJobData {
  userId: string;
}

export const reputationSyncQueue = new Queue<ReputationSyncJobData>(
  QUEUE_NAMES.REPUTATION_SYNC,
  {
    connection: redisConnection,
    defaultJobOptions,
  },
);

/**
 * Schedule a reputation sync for a user to reconcile on-chain loyalty points.
 */
export async function scheduleReputationSync(
  userId: string,
): Promise<void> {
  await reputationSyncQueue.add('sync-reputation', { userId }, {
    jobId: `reputation-sync:${userId}:${Date.now()}`,
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 }
  });
}
