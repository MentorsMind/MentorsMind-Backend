import { Worker, Job } from 'bullmq';
import {
  redisConnection,
  CONCURRENCY,
  QUEUE_NAMES,
} from '../queues/queue.config';
import { logger } from '../utils/logger.utils';
import { ReputationService } from '../services/reputation.service';
import { LoyaltyService } from '../services/loyalty.service';
import { WalletModel } from '../models/wallet.model';
import type { ReputationSyncJobData } from '../queues/reputation-sync.queue';
import pool from '../config/database';

async function processReputationSync(
  job: Job<ReputationSyncJobData>,
): Promise<void> {
  const { userId } = job.data;
  
  logger.info('Processing reputation sync', { jobId: job.id, userId });

  // 1. Get the user's Stellar public key
  const wallet = await WalletModel.findByUserId(userId);
  if (!wallet || !wallet.stellar_public_key) {
    logger.warn('Reputation sync skipped: no stellar wallet found', { userId });
    return;
  }

  // 2. Fetch on-chain points
  let onChainPoints = 0;
  try {
    onChainPoints = await ReputationService.getOnChainLoyaltyPoints(wallet.stellar_public_key);
  } catch (error: any) {
    logger.error('Failed to get on-chain loyalty points', { userId, error: error.message });
    throw error;
  }

  // 3. Get off-chain account
  const account = await LoyaltyService.getOrCreateAccount(userId);
  const offChainPoints = parseFloat(account.balance);

  // 4. Compare and log discrepancies
  const getTier = (points: number) => {
    if (points >= 1000) return 'platinum';
    if (points >= 500) return 'gold';
    if (points >= 100) return 'silver';
    return 'bronze';
  };

  const onChainTier = getTier(onChainPoints);
  const offChainTier = account.tier;

  if (onChainPoints !== offChainPoints) {
    logger.info('Loyalty points discrepancy detected', {
      userId,
      onChainPoints,
      offChainPoints
    });

    if (onChainTier !== offChainTier) {
      // Expose tier discrepancies in admin monitoring (logs tracked by Datadog)
      logger.error('LOYALTY_TIER_DISCREPANCY_ALERT', {
        userId,
        onChainTier,
        offChainTier,
        onChainPoints,
        offChainPoints,
      });
    }

    // 5. Idempotent upsert to reconcile (On-chain is source of truth for total accrued)
    await pool.query(
      `UPDATE loyalty_accounts
       SET balance = $1,
           earned = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $2`,
      [onChainPoints, userId],
    );

    logger.info('Loyalty points reconciled', { userId, newBalance: onChainPoints });
  } else {
    logger.debug('Loyalty points in sync', { userId, points: onChainPoints });
  }
}

export const reputationSyncWorker = new Worker<ReputationSyncJobData>(
  QUEUE_NAMES.REPUTATION_SYNC,
  processReputationSync,
  {
    connection: redisConnection,
    concurrency: CONCURRENCY.REPUTATION_SYNC || 5,
  },
);

reputationSyncWorker.on('completed', (job) => {
  logger.info('Reputation sync job completed', {
    jobId: job.id,
    userId: job.data.userId,
  });
});

reputationSyncWorker.on('failed', (job, err) => {
  logger.error('Reputation sync job failed', {
    jobId: job?.id,
    userId: job?.data?.userId,
    attempt: job?.attemptsMade,
    error: err.message,
  });
});

reputationSyncWorker.on('error', (err) => {
  logger.error('Reputation sync worker error', { error: err.message });
});
