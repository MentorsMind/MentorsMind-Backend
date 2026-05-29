import { Worker, Job } from "bullmq";
import pool from "../config/database";
import {
  redisConnection,
  CONCURRENCY,
  QUEUE_NAMES,
} from "../queues/queue.config";
import { logger } from "../utils/logger.utils";
import { AuditLoggerService } from "../services/audit-logger.service";
import { LogLevel, AuditAction } from "../utils/log-formatter.utils";
import type { PaymentPollJobData } from "../queues/payment-poll.queue";
import { stellarService } from "../services/stellar.service";

export async function pollPaymentStatus(
  job: Job<PaymentPollJobData>,
): Promise<void> {
  const { paymentId, userId, transactionHash } = job.data;

  logger.info("Polling payment status", {
    jobId: job.id,
    paymentId,
    attempt: job.attemptsMade,
  });

  // Fetch current payment status from DB
  const { rows } = await pool.query<{
    status: string;
    transaction_hash: string | null;
  }>("SELECT status, transaction_hash FROM transactions WHERE id = $1", [
    paymentId,
  ]);

  if (!rows.length) {
    throw new Error(`Payment ${paymentId} not found`);
  }

  const payment = rows[0];

  // Already resolved — nothing to do
  if (payment.status === "completed" || payment.status === "failed") {
    logger.info("Payment already resolved, skipping poll", {
      paymentId,
      status: payment.status,
    });
    return;
  }

  // If there's a transaction hash, verify on Stellar
  const hash = transactionHash || payment.stellar_tx_hash;
  if (hash) {
    try {
      // submitTransaction will throw if the tx is not found/failed;
      // For now, treat any successful response as confirmation.
      const tx = await stellarService.getTransaction(hash).catch(() => null);
      const confirmed = tx?.successful === true;

      if (confirmed) {
        await pool.query(
          "UPDATE transactions SET status = 'completed', updated_at = NOW() WHERE id = $1",
          [paymentId],
        );
        logger.info("Payment marked completed via Stellar", {
          paymentId,
          hash,
        });

        await AuditLoggerService.logEvent({
          level: LogLevel.INFO,
          action: AuditAction.PAYMENT_PROCESSED,
          message: `Payment ${paymentId} confirmed on Stellar`,
          userId,
          entityType: "payment",
          entityId: paymentId,
          metadata: { transactionHash: hash },
        });
        return;
      }
    } catch (err) {
      logger.warn("Stellar tx lookup failed, will retry", {
        paymentId,
        hash,
        error: (err as Error).message,
      });
    }
  }

  // Not yet confirmed — throw to trigger retry
  throw new Error(
    `Payment ${paymentId} still pending (attempt ${job.attemptsMade})`,
  );
}

export const paymentWorker = new Worker<PaymentPollJobData>(
  QUEUE_NAMES.PAYMENT_POLL,
  pollPaymentStatus,
  {
    connection: redisConnection,
    concurrency: CONCURRENCY.PAYMENT_POLL,
  },
);

paymentWorker.on("completed", (job) => {
  logger.info("Payment poll job completed", {
    jobId: job.id,
    paymentId: job.data.paymentId,
  });
});

paymentWorker.on("failed", (job, err) => {
  const isExhausted = (job?.attemptsMade ?? 0) >= (job?.opts?.attempts ?? 20);
  const level = isExhausted ? "error" : "warn";

  logger[level]("Payment poll job failed", {
    jobId: job?.id,
    paymentId: job?.data?.paymentId,
    attempt: job?.attemptsMade,
    maxAttempts: job?.opts?.attempts,
    error: err.message,
  });

  if (isExhausted) {
    AuditLoggerService.logEvent({
      level: LogLevel.ERROR,
      action: AuditAction.PAYMENT_PROCESSED,
      message: `Payment poll exhausted (unresolved) for payment ${job?.data?.paymentId}`,
      userId: job?.data?.userId,
      entityType: "payment",
      entityId: job?.data?.paymentId,
      metadata: { error: err.message },
    }).catch(() => {});
  }
});

paymentWorker.on("error", (err) => {
  logger.error("Payment worker error", { error: err.message });
});
