import { Queue } from 'bullmq';
import {
  redisConnection,
  defaultJobOptions,
  QUEUE_NAMES,
} from '../config/queue';

export interface AuthAttemptJobData {
  userId: string | null;
  email: string;
  success: boolean;
  failureReason?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  riskScore?: number;
  timestamp: string;
}

export const authAttemptQueue = new Queue<AuthAttemptJobData>(
  QUEUE_NAMES.AUTH_ATTEMPT,
  {
    connection: redisConnection,
    defaultJobOptions,
  }
);

/**
 * Enqueue an authentication attempt for asynchronous logging and risk analysis.
 * This ensures that even during high-load or DB slowness, auth attempts are
 * eventually recorded without blocking the login flow.
 */
export async function enqueueAuthAttempt(
  data: AuthAttemptJobData
): Promise<void> {
  await authAttemptQueue.add('log-auth-attempt', data, {
    // High failure-rate attacks shouldn't overwhelm the queue's memory if it gets backed up
    removeOnComplete: true,
    removeOnFail: { age: 24 * 3600 }, // Keep failed for 24h for analysis
  });
}
