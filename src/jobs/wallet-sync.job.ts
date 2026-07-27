/**
 * Wallet Balance Sync Job
 * 
 * Runs periodically to sync all active wallets with on-chain Stellar state.
 * Ensures PostgreSQL balances never drift from blockchain reality.
 * 
 * Execution:
 * - Runs every 5 minutes (configurable via WALLET_SYNC_INTERVAL_MINUTES)
 * - Processes wallets in batches with configurable concurrency
 * - Auto-corrects drifts for non-manual syncs
 * - Logs all discrepancies for auditing
 */

import cron from 'node-cron';
import { db } from '../config/database';
import { WalletSyncService } from '../services/wallet-sync.service';
import { logger } from '../utils/logger.utils';

interface SyncJobConfig {
  enabled: boolean;
  schedule: string; // Cron expression: default "*/5 * * * *" (every 5 min)
  batchSize: number; // How many users per batch
  concurrency: number; // Concurrent syncs per batch
  maxRetries: number; // Retry failed syncs
  stopOnError: boolean; // Stop entire job on error
}

let syncJobTask: cron.ScheduledTask | null = null;
let isRunning = false;

/**
 * Get default job configuration
 */
function getJobConfig(): SyncJobConfig {
  return {
    enabled: process.env.WALLET_SYNC_ENABLED !== 'false',
    schedule: process.env.WALLET_SYNC_SCHEDULE || '*/5 * * * *',
    batchSize: parseInt(process.env.WALLET_SYNC_BATCH_SIZE || '100', 10),
    concurrency: parseInt(process.env.WALLET_SYNC_CONCURRENCY || '5', 10),
    maxRetries: parseInt(process.env.WALLET_SYNC_MAX_RETRIES || '3', 10),
    stopOnError: process.env.WALLET_SYNC_STOP_ON_ERROR !== 'true',
  };
}

/**
 * Get all active wallets that need syncing
 */
async function getWalletsToSync(): Promise<string[]> {
  const query = `
    SELECT user_id FROM wallets 
    WHERE status = 'active'
    ORDER BY updated_at ASC
  `;
  const { rows } = await db.query(query);
  return rows.map(r => r.user_id);
}

/**
 * Main sync job handler
 */
async function runSyncJob(): Promise<void> {
  if (isRunning) {
    logger.warn('wallet_sync_job_already_running');
    return;
  }

  isRunning = true;
  const startTime = Date.now();
  const config = getJobConfig();

  try {
    logger.info('wallet_sync_job_started', {
      schedule: config.schedule,
      batchSize: config.batchSize,
      concurrency: config.concurrency,
    });

    // Get all active wallets
    const userIds = await getWalletsToSync();
    if (userIds.length === 0) {
      logger.info('wallet_sync_job_no_wallets');
      return;
    }

    logger.info('wallet_sync_job_processing', {
      totalWallets: userIds.length,
      batches: Math.ceil(userIds.length / config.batchSize),
    });

    // Process in batches
    let successCount = 0;
    let driftCount = 0;
    let errorCount = 0;

    for (let i = 0; i < userIds.length; i += config.batchSize) {
      const batch = userIds.slice(i, i + config.batchSize);
      const batchNum = Math.floor(i / config.batchSize) + 1;

      logger.debug('wallet_sync_job_batch', {
        batch: batchNum,
        size: batch.length,
        from: i,
        to: Math.min(i + config.batchSize, userIds.length),
      });

      try {
        const results = await WalletSyncService.syncWallets(
          batch,
          'scheduled',
          {
            concurrency: config.concurrency,
            stopOnError: config.stopOnError,
          }
        );

        successCount += results.length;
        driftCount += results.filter(r => r.hadDrift).length;

        // Log batch completion
        logger.info('wallet_sync_job_batch_completed', {
          batch: batchNum,
          processed: results.length,
          drifted: results.filter(r => r.hadDrift).length,
          duration_ms: results[0]?.metadata.duration_ms,
        });
      } catch (batchError) {
        errorCount += batch.length;
        logger.error('wallet_sync_job_batch_failed', {
          batch: batchNum,
          size: batch.length,
          error: batchError instanceof Error ? batchError.message : batchError,
        });

        if (config.stopOnError) {
          throw batchError;
        }
      }
    }

    // Get sync statistics
    const stats = await WalletSyncService.getSyncStatistics(1);

    const duration = Date.now() - startTime;

    logger.info('wallet_sync_job_completed', {
      totalWallets: userIds.length,
      successCount,
      errorCount,
      driftCount,
      driftPercentage: stats.driftPercentage.toFixed(2),
      duration_ms: duration,
      rate: (userIds.length / (duration / 1000)).toFixed(2),
    });
  } catch (error) {
    logger.error('wallet_sync_job_failed', {
      error: error instanceof Error ? error.message : error,
      duration_ms: Date.now() - startTime,
    });
  } finally {
    isRunning = false;
  }
}

/**
 * Start the wallet sync job
 */
export function startWalletSyncJob(): void {
  const config = getJobConfig();

  if (!config.enabled) {
    logger.info('wallet_sync_job_disabled');
    return;
  }

  // Validate cron expression
  if (!cron.validate(config.schedule)) {
    logger.error('wallet_sync_job_invalid_schedule', { schedule: config.schedule });
    return;
  }

  syncJobTask = cron.schedule(config.schedule, runSyncJob, {
    timezone: 'UTC',
    runOnInit: false, // Don't run immediately on startup
  });

  logger.info('wallet_sync_job_started', {
    schedule: config.schedule,
    timezone: 'UTC',
  });
}

/**
 * Stop the wallet sync job
 */
export function stopWalletSyncJob(): void {
  if (syncJobTask) {
    syncJobTask.stop();
    syncJobTask = null;
    logger.info('wallet_sync_job_stopped');
  }
}

/**
 * Manually trigger a sync (bypasses schedule)
 * Useful for testing and on-demand syncing
 */
export async function triggerWalletSyncJob(): Promise<void> {
  logger.info('wallet_sync_job_manually_triggered');
  await runSyncJob();
}

/**
 * Get job status
 */
export function getWalletSyncJobStatus(): {
  enabled: boolean;
  running: boolean;
  schedule?: string;
} {
  const config = getJobConfig();
  return {
    enabled: config.enabled,
    running: isRunning,
    schedule: config.enabled ? config.schedule : undefined,
  };
}

export default { startWalletSyncJob, stopWalletSyncJob, triggerWalletSyncJob };
