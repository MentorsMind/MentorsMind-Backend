import { Worker, Job } from 'bullmq';
import {
  redisConnection,
  CONCURRENCY,
  QUEUE_NAMES,
} from '../queues/queue.config';
import { EscrowApiService } from '../services/escrow-api.service';
import { logger } from '../utils/logger.utils';
import { AuditLoggerService } from '../services/audit-logger.service';
import { LogLevel, AuditAction } from '../utils/log-formatter.utils';
import type { EscrowReleaseJobData } from '../queues/escrow-release.queue';

const SYSTEM_USER_ID = 'system';

async function processEscrowRelease(
  job: Job<EscrowReleaseJobData>,
): Promise<void> {
  const { escrowId, mentorId, learnerId } = job.data;

  logger.info('Processing escrow auto-release', { jobId: job.id, escrowId });

  // Check current escrow status from DB (not cache) to handle race conditions
  const escrow = await EscrowApiService.getEscrowById(escrowId);

  if (!escrow) {
    throw new Error(`Escrow ${escrowId} not found`);
  }

  // Skip if already released, disputed, refunded, or cancelled
  // This check prevents release if a dispute was raised while the job was active
  if (
    ['released', 'disputed', 'refunded', 'cancelled'].includes(escrow.status)
  ) {
    logger.info('Escrow auto-release skipped — already resolved', {
      escrowId,
      status: escrow.status,
    });
    return;
  }

  await EscrowApiService.releaseEscrow(escrowId, SYSTEM_USER_ID);

  logger.info('Escrow auto-released', { escrowId, mentorId, learnerId });

  await AuditLoggerService.logEvent({
    level: LogLevel.INFO,
    action: AuditAction.ADMIN_ACTION,
    message: `Escrow ${escrowId} auto-released after 48h`,
    userId: SYSTEM_USER_ID,
    entityType: 'escrow',
    entityId: escrowId,
    metadata: { mentorId, learnerId, trigger: 'auto-release-48h' },
  });
}

export const escrowReleaseWorker = new Worker<EscrowReleaseJobData>(
  QUEUE_NAMES.ESCROW_RELEASE,
  processEscrowRelease,
  {
    connection: redisConnection,
    concurrency: CONCURRENCY.ESCROW_RELEASE,
  },
);

escrowReleaseWorker.on('completed', (job) => {
  logger.info('Escrow release job completed', {
    jobId: job.id,
    escrowId: job.data.escrowId,
  });
});

escrowReleaseWorker.on('failed', (job, err) => {
  logger.error('Escrow release job failed', {
    jobId: job?.id,
    escrowId: job?.data?.escrowId,
    attempt: job?.attemptsMade,
    error: err.message,
  });
});

escrowReleaseWorker.on('error', (err) => {
  logger.error('Escrow release worker error', { error: err.message });
});
