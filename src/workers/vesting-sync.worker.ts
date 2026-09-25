import { Worker, Job } from 'bullmq';
import {
  redisConnection,
  CONCURRENCY,
  QUEUE_NAMES,
} from '../queues/queue.config';
import { VestingService } from '../services/vesting.service';
import { logger } from '../utils/logger.utils';
import pool from '../config/database';

export interface VestingSyncJobData {
  scheduleId?: number; // Optional: sync specific schedule
}

/**
 * Process vesting schedule sync job
 * Syncs active vesting schedules with on-chain data
 */
async function processVestingSync(
  job: Job<VestingSyncJobData>,
): Promise<void> {
  const { scheduleId } = job.data;

  if (scheduleId) {
    // Sync specific schedule
    logger.info('Syncing specific vesting schedule', {
      jobId: job.id,
      scheduleId,
    });

    try {
      await VestingService.syncSchedule(scheduleId);
      logger.info('Vesting schedule synced successfully', { scheduleId });
    } catch (error) {
      logger.error('Failed to sync vesting schedule', {
        scheduleId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    return;
  }

  // Sync all active schedules
  logger.info('Starting vesting schedules batch sync', { jobId: job.id });

  const syncStartTime = Date.now();
  const syncLogId = await logSyncStart();

  try {
    const result = await VestingService.syncAllSchedules();

    const syncDuration = Date.now() - syncStartTime;

    await logSyncComplete(
      syncLogId,
      result.synced,
      result.failed,
      syncDuration,
    );

    logger.info('Vesting schedules batch sync completed', {
      synced: result.synced,
      failed: result.failed,
      durationMs: syncDuration,
    });

    if (result.failed > 0) {
      logger.warn('Some vesting schedules failed to sync', {
        failed: result.failed,
        synced: result.synced,
      });
    }
  } catch (error) {
    const syncDuration = Date.now() - syncStartTime;
    await logSyncError(
      syncLogId,
      error instanceof Error ? error.message : String(error),
      syncDuration,
    );

    logger.error('Vesting schedules batch sync failed', {
      error: error instanceof Error ? error.message : String(error),
      durationMs: syncDuration,
    });

    throw error;
  }
}

/**
 * Log sync start
 */
async function logSyncStart(): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO vesting_sync_log (sync_started_at)
     VALUES (NOW())
     RETURNING id`,
  );
  return rows[0].id;
}

/**
 * Log sync completion
 */
async function logSyncComplete(
  syncLogId: number,
  schedulesSynced: number,
  schedulesFailed: number,
  durationMs: number,
): Promise<void> {
  await pool.query(
    `UPDATE vesting_sync_log
     SET sync_completed_at = NOW(),
         schedules_synced = $1,
         schedules_failed = $2,
         sync_duration_ms = $3
     WHERE id = $4`,
    [schedulesSynced, schedulesFailed, durationMs, syncLogId],
  );
}

/**
 * Log sync error
 */
async function logSyncError(
  syncLogId: number,
  errorMessage: string,
  durationMs: number,
): Promise<void> {
  await pool.query(
    `UPDATE vesting_sync_log
     SET sync_completed_at = NOW(),
         error_message = $1,
         sync_duration_ms = $2
     WHERE id = $3`,
    [errorMessage, durationMs, syncLogId],
  );
}

export const vestingSyncWorker = new Worker<VestingSyncJobData>(
  'vesting-sync-queue',
  processVestingSync,
  {
    connection: redisConnection,
    concurrency: 1 || 1,
  },
);

vestingSyncWorker.on('completed', (job) => {
  logger.info('Vesting sync job completed', {
    jobId: job.id,
    scheduleId: job.data.scheduleId,
  });
});

vestingSyncWorker.on('failed', (job, err) => {
  logger.error('Vesting sync job failed', {
    jobId: job?.id,
    scheduleId: job?.data?.scheduleId,
    attempt: job?.attemptsMade,
    error: err.message,
  });
});

vestingSyncWorker.on('error', (err) => {
  logger.error('Vesting sync worker error', { error: err.message });
});
