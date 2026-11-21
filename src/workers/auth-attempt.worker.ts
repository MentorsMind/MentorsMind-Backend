import { Worker, Job } from 'bullmq';
import {
  redisConnection,
  QUEUE_NAMES,
} from '../config/queue';
import { logger } from '../utils/logger.utils';
import pool from '../config/database';
import type { AuthAttemptJobData } from '../queues/auth-attempt.queue';

/**
 * Auth Attempt Worker
 *
 * Persists authentication attempts to the database asynchronously.
 * Retries automatically on failure (e.g. database connection issues).
 */
async function processAuthAttempt(
  job: Job<AuthAttemptJobData>,
): Promise<void> {
  const { 
    userId, 
    email, 
    success, 
    failureReason, 
    ipAddress, 
    userAgent, 
    riskScore,
    timestamp 
  } = job.data;

  try {
    await pool.query(`
      INSERT INTO auth_attempts (
        user_id, email, success, failure_reason, ip_address, user_agent, 
        risk_score, authentication_method, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'password', $8)
    `, [
      userId,
      email,
      success,
      failureReason,
      ipAddress,
      userAgent,
      riskScore,
      timestamp
    ]);
  } catch (error) {
    logger.error('Worker failed to persist auth attempt:', {
      jobId: job.id,
      error,
      email
    });
    // Re-throw so BullMQ handles the retry based on backoff policy
    throw error;
  }
}

export const authAttemptWorker = new Worker<AuthAttemptJobData>(
  QUEUE_NAMES.AUTH_ATTEMPT,
  processAuthAttempt,
  {
    connection: redisConnection,
    // Concurrency can be tuned based on load; 5 is a safe default for logging
    concurrency: 5,
  },
);

authAttemptWorker.on('completed', (job) => {
  logger.debug('Auth attempt logged successfully', {
    jobId: job.id,
    email: job.data.email,
  });
});

authAttemptWorker.on('failed', (job, err) => {
  logger.error('Auth attempt logging job failed', {
    jobId: job?.id,
    email: job?.data.email,
    error: err.message,
  });
});
