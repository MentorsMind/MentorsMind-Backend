import { Worker, Job } from "bullmq";
import {
  redisConnection,
  CONCURRENCY,
  QUEUE_NAMES,
} from "../queues/queue.config";
import { EscrowApiService } from "../services/escrow-api.service";
import { logger } from "../utils/logger.utils";
import { AuditLoggerService } from "../services/audit-logger.service";
import { LogLevel, AuditAction } from "../utils/log-formatter.utils";
import pool from "../config/database";
import type { EscrowCheckJobData } from "../queues/escrow-check.queue";

const SYSTEM_USER_ID = "system";
const RELEASE_WINDOW_HOURS = 48;

/**
 * Find escrows that have been in 'funded' or 'pending' status for longer
 * than the auto-release window and have no active dispute.
 */
async function findEligibleEscrows(): Promise<
  Array<{ id: string; learner_id: string; mentor_id: string }>
> {
  const { rows } = await pool.query<{
    id: string;
    learner_id: string;
    mentor_id: string;
  }>(
    `SELECT e.id, e.learner_id, e.mentor_id
     FROM escrows e
     WHERE e.status IN ('funded', 'pending')
       AND e.created_at < NOW() - INTERVAL '${RELEASE_WINDOW_HOURS} hours'
       AND NOT EXISTS (
         SELECT 1 FROM disputes d
         WHERE d.escrow_id = e.id
           AND d.status NOT IN ('resolved', 'closed')
       )
     LIMIT 100`,
  );
  return rows;
}

async function processEscrowCheck(job: Job<EscrowCheckJobData>): Promise<void> {
  const { triggeredAt } = job.data;

  logger.info("Escrow check job started", { jobId: job.id, triggeredAt });

  const eligible = await findEligibleEscrows();

  if (eligible.length === 0) {
    logger.info("Escrow check: no eligible escrows found", { jobId: job.id });
    return;
  }

  logger.info("Escrow check: found eligible escrows", {
    jobId: job.id,
    count: eligible.length,
  });

  let released = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const escrow of eligible) {
    try {
      await EscrowApiService.releaseEscrow(escrow.id, SYSTEM_USER_ID);

      await AuditLoggerService.logEvent({
        level: LogLevel.INFO,
        action: AuditAction.ADMIN_ACTION,
        message: `Escrow ${escrow.id} auto-released by hourly check`,
        userId: SYSTEM_USER_ID,
        entityType: "escrow",
        entityId: escrow.id,
        metadata: {
          mentorId: escrow.mentor_id,
          learnerId: escrow.learner_id,
          trigger: `escrow-check-cron-${RELEASE_WINDOW_HOURS}h`,
        },
      });

      released++;
    } catch (err) {
      const msg = (err as Error).message;
      // Skip if already resolved in a concurrent update
      if (msg.includes("Cannot release escrow")) {
        skipped++;
      } else {
        errors.push(`escrow ${escrow.id}: ${msg}`);
        logger.error("Escrow check: release failed", {
          jobId: job.id,
          escrowId: escrow.id,
          error: msg,
        });
      }
    }
  }

  logger.info("Escrow check job completed", {
    jobId: job.id,
    released,
    skipped,
    errors: errors.length,
  });

  if (errors.length > 0) {
    // Surface partial failures without failing the whole job
    logger.warn("Escrow check: some releases failed", {
      jobId: job.id,
      errors,
    });
  }
}

export const escrowCheckWorker = new Worker<EscrowCheckJobData>(
  QUEUE_NAMES.ESCROW_CHECK,
  processEscrowCheck,
  {
    connection: redisConnection,
    concurrency: CONCURRENCY.ESCROW_CHECK,
  },
);

escrowCheckWorker.on("completed", (job) => {
  logger.info("Escrow check job completed", { jobId: job.id });
});

escrowCheckWorker.on("failed", (job, err) => {
  logger.error("Escrow check job failed", {
    jobId: job?.id,
    error: err.message,
  });
});

escrowCheckWorker.on("error", (err) => {
  logger.error("Escrow check worker error", { error: err.message });
});
