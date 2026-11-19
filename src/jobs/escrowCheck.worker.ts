import { Worker, Job } from "bullmq";
import {
  redisConnection,
  CONCURRENCY,
  QUEUE_NAMES,
} from "../queues/queue.config";
import { EscrowApiService } from "../services/escrow-api.service";
import { SorobanEscrowService } from "../services/sorobanEscrow.service";
import { DisputeService } from "../services/disputes.service";
import { redis } from "../config/redis";
import { escrowSyncMismatchesTotal } from "../config/metrics";
import { logger } from "../utils/logger.utils";
import { AuditLoggerService } from "../services/audit-logger.service";
import { LogLevel, AuditAction } from "../utils/log-formatter.utils";
import pool from "../config/database";
import type { EscrowCheckJobData } from "../queues/escrow-check.queue";

const SYSTEM_USER_ID = "system";
const RELEASE_WINDOW_HOURS = 48;

/**
 * Find bookings with escrows that have been in 'held_in_escrow' status
 * and have no active dispute. We query the bookings table as it contains
 * the escrow_contract_address required for Soroban checks.
 */
async function findEligibleEscrows(): Promise<
  Array<{ id: string; escrow_id: string; escrow_contract_address: string; mentor_id: string; mentee_id: string; payment_status: string }>
> {
  const { rows } = await pool.query(
    `SELECT b.id, b.escrow_id, b.escrow_contract_address, b.mentor_id, b.mentee_id, b.payment_status
     FROM bookings b
     WHERE b.status IN ('confirmed', 'completed')
       AND b.escrow_id IS NOT NULL
       AND b.escrow_contract_address IS NOT NULL
       AND b.payment_status = 'held_in_escrow'
       AND b.created_at < NOW() - INTERVAL '${RELEASE_WINDOW_HOURS} hours'
       AND NOT EXISTS (
         SELECT 1 FROM disputes d
         WHERE d.escrow_id = b.escrow_id
           AND d.status NOT IN ('resolved', 'closed')
       )
     LIMIT 50`
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

  for (const booking of eligible) {
    const skipKey = `escrow:check:skip:${booking.escrow_id}`;
    
    try {
      // Check Redis skip cache
      if (await redis.exists(skipKey)) {
        skipped++;
        continue;
      }

      // Check on-chain state
      const onChainState = await SorobanEscrowService.getEscrowState(
        booking.escrow_id,
        booking.escrow_contract_address
      );

      if (onChainState.status === "released" && booking.payment_status === "held_in_escrow") {
        escrowSyncMismatchesTotal.inc({ type: "released_mismatch" });
        await pool.query(
          `UPDATE bookings SET payment_status = 'paid', updated_at = NOW() WHERE id = $1`,
          [booking.id]
        );
        logger.warn(`Corrected released mismatch for escrow ${booking.escrow_id}`);
        released++;
      } else if (onChainState.status === "disputed") {
        escrowSyncMismatchesTotal.inc({ type: "disputed_mismatch" });
        await (DisputeService.openDispute as any)({
          escrowId: booking.escrow_id,
          raisedBy: SYSTEM_USER_ID,
          reason: "On-chain dispute detected",
        });
        logger.warn(`Corrected disputed mismatch for escrow ${booking.escrow_id}`);
      } else if (onChainState.status === "refunded" && booking.payment_status !== "refunded") {
        escrowSyncMismatchesTotal.inc({ type: "refunded_mismatch" });
        await pool.query(
          `UPDATE bookings SET payment_status = 'refunded', updated_at = NOW() WHERE id = $1`,
          [booking.id]
        );
        logger.warn(`Corrected refunded mismatch for escrow ${booking.escrow_id}`);
      } else if (onChainState.status === "funded" || onChainState.status === "pending") {
        // Safe to release off-chain logic
        await EscrowApiService.releaseEscrow(booking.escrow_id, SYSTEM_USER_ID);
        await AuditLoggerService.logEvent({
          level: LogLevel.INFO,
          action: AuditAction.ADMIN_ACTION,
          message: `Escrow ${booking.escrow_id} auto-released by hourly check`,
          userId: SYSTEM_USER_ID,
          entityType: "escrow",
          entityId: booking.escrow_id,
          metadata: {
            mentorId: booking.mentor_id,
            learnerId: booking.mentee_id,
            trigger: `escrow-check-cron-${RELEASE_WINDOW_HOURS}h`,
          },
        });
        released++;
      }

      // Set skip cache for 30 minutes
      await redis.set(skipKey, "1", "EX", 1800);
      
      // Batch processing spacing
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("Cannot release escrow")) {
        skipped++;
      } else {
        errors.push(`escrow ${booking.escrow_id}: ${msg}`);
        logger.error("Escrow check: operation failed", {
          jobId: job.id,
          escrowId: booking.escrow_id,
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
    logger.warn("Escrow check: some operations failed", {
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
