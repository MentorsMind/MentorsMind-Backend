import { Worker, Job } from "bullmq";
import { Asset, TransactionBuilder, Transaction } from "@stellar/stellar-sdk";
import { redis } from "../config/redis";
import { getPlatformKeypair, networkPassphrase } from "../config/stellar";
import {
  redisConnection,
  CONCURRENCY,
  QUEUE_NAMES,
} from "../queues/queue.config";
import { stellarService } from "../services/stellar.service";
import { logger } from "../utils/logger.utils";
import { AuditLoggerService } from "../services/audit-logger.service";
import { LogLevel, AuditAction } from "../utils/log-formatter.utils";
import pool from "../config/database";
import { PaymentsService } from "../services/payments.service";
import { VerificationService } from "../services/verification.service";
import type { StellarTxJobData } from "../queues/stellar-tx.queue";

/**
 * Handles `type: 'verification'` jobs — a reliable, independently-retried
 * delivery path for on-chain mentor verification submissions that failed
 * during the direct retry sweep (see VerificationService.retryPendingOnChainVerifications,
 * issue #768). Submission itself is idempotent, so re-running this after a
 * partial failure is safe.
 */
async function processVerificationTx(job: Job<StellarTxJobData>): Promise<void> {
  const { userId: mentorId, metadata } = job.data;
  const verificationId = metadata?.verificationId as string | undefined;

  logger.info("Verification on-chain retry job started", {
    jobId: job.id,
    mentorId,
    verificationId,
    attempt: job.attemptsMade + 1,
  });

  const txHash = await VerificationService.triggerOnChainVerification(mentorId);
  if (!txHash) {
    throw new Error(
      `On-chain verification retry produced no tx hash for mentor ${mentorId}`,
    );
  }

  if (verificationId) {
    await pool.query(
      `UPDATE mentor_verifications
       SET on_chain_tx_hash = $1, on_chain_pending = FALSE, retry_count = 0,
           last_retry_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [txHash, verificationId],
    );
  }

  logger.info("Verification on-chain retry job succeeded", {
    jobId: job.id,
    mentorId,
    verificationId,
    txHash,
  });
}

export async function processStellarTx(job: Job<StellarTxJobData>): Promise<void> {
  const {
    txEnvelopeXdr,
    userId,
    paymentId,
    type,
    amount,
    currency,
    description,
  } = job.data;

  if (type === "verification") {
    return processVerificationTx(job);
  }

  logger.info("Stellar TX job started", {
    jobId: job.id,
    userId,
    paymentId,
    type,
    attempt: job.attemptsMade + 1,
  });

  // Idempotency check
  const idempotencyKey = `stellar_tx:success:${job.id}`;
  if (await redis.exists(idempotencyKey)) {
    logger.info("Stellar TX job already processed", { jobId: job.id });
    return;
  }

  let xdr = txEnvelopeXdr;
  if (!xdr && type === "refund" && paymentId && amount && currency) {
    const payment = await pool.query(
      "SELECT from_address FROM transactions WHERE id = $1",
      [paymentId],
    );
    if (!payment.rows[0]?.from_address) {
      throw new Error("No from_address found for refund");
    }
    const toPublicKey = payment.rows[0].from_address;
    xdr = await stellarService.buildRefundTransaction(
      toPublicKey,
      amount,
      currency === "XLM" ? undefined : new Asset(currency, "GA..."),
    ); 
  }

  if (!xdr) {
    throw new Error("No transaction XDR to submit");
  }

  // Parse TX to check expiry
  let tx = TransactionBuilder.fromXDR(xdr, networkPassphrase) as Transaction;
  
  // Check if expired
  if (tx.timeBounds && tx.timeBounds.maxTime && tx.timeBounds.maxTime !== "0") {
    const maxTime = parseInt(tx.timeBounds.maxTime, 10);
    const now = Math.floor(Date.now() / 1000);
    if (maxTime < now) {
      logger.warn("Stellar transaction expired, rebuilding", { jobId: job.id });
      const sourceAccount = await stellarService.getAccount(tx.source);
      const builder = new TransactionBuilder(sourceAccount as any, {
        fee: tx.fee,
        networkPassphrase,
      }).setTimeout(30);
      tx.operations.forEach((op) => builder.addOperation(op as any));
      tx = builder.build();
        
      const kp = getPlatformKeypair();
      if (kp) tx.sign(kp);
      xdr = tx.toXDR();
    }
  }

  let result;
  try {
    result = await stellarService.submitTransaction(xdr);
  } catch (err: any) {
    const txResultCode = err?.response?.data?.extras?.result_codes?.transaction;
    if (txResultCode === "tx_bad_seq") {
      logger.warn("tx_bad_seq encountered, rebuilding transaction", { jobId: job.id });
      const sourceAccount = await stellarService.getAccount(tx.source);
      const builder = new TransactionBuilder(sourceAccount as any, {
        fee: tx.fee,
        networkPassphrase,
      }).setTimeout(30);
      tx.operations.forEach((op) => builder.addOperation(op as any));
      tx = builder.build();
      const kp = getPlatformKeypair();
      if (kp) tx.sign(kp);
      xdr = tx.toXDR();
      try {
        result = await stellarService.submitTransaction(xdr);
      } catch (retryErr: any) {
        err = retryErr;
      }
    } else if (txResultCode === "tx_insufficient_fee") {
      logger.warn("tx_insufficient_fee encountered, bumping fee", { jobId: job.id });
      const newFee = String(parseInt(tx.fee, 10) * 2);
      const feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(
        getPlatformKeypair()!,
        newFee,
        tx,
        networkPassphrase
      );
      const kp = getPlatformKeypair();
      if (kp) feeBumpTx.sign(kp);
      xdr = feeBumpTx.toXDR();
      try {
        result = await stellarService.submitTransaction(xdr);
      } catch (retryErr: any) {
        err = retryErr;
      }
    }

    if (!result) {
      let stellarTxHash: string | undefined;
      try {
        stellarTxHash = (job.data as any).txHash || (tx ? tx.hash().toString("hex") : undefined);
      } catch {
        stellarTxHash = (job.data as any).txHash;
      }

      logger.error("Stellar transaction rejected", {
        stellar_tx_hash: stellarTxHash,
        stellar_result_code: err?.response?.data?.extras?.result_codes,
        ledger_sequence: err?.response?.data?.extras?.ledger,
        job_id: job.id,
        attempt_number: job.attemptsMade + 1,
        error_message: err.message,
      });

      if (paymentId) {
        await pool.query(
          "UPDATE transactions SET status = 'failed', updated_at = NOW() WHERE id = $1",
          [paymentId],
        );
      }
      
      const wrappedErr = new Error(`Stellar transaction rejected: ${txResultCode || err.message}`);
      (wrappedErr as any).retryable = false;
      throw wrappedErr;
    }
  }

  if (!result || !result.successful) {
    if (paymentId) {
      await pool.query(
        "UPDATE transactions SET status = 'failed', updated_at = NOW() WHERE id = $1",
        [paymentId],
      );
    }
    const err = new Error(`Stellar transaction unsuccessful`);
    (err as any).retryable = false;
    throw err;
  }

  logger.info("Stellar transaction confirmed", {
    jobId: job.id,
    stellar_tx_hash: result.hash,
    ledger_sequence: result.ledger,
    paymentId,
  });

  // Save idempotency key
  await redis.set(idempotencyKey, result.hash, "EX", 86400);

  if (paymentId) {
    if (type === "refund") {
      await PaymentsService.refundPayment(
        paymentId,
        userId,
        amount,
        description,
        result.hash,
      );
    } else {
      await pool.query(
        "UPDATE transactions SET status = 'completed', stellar_tx_hash = $1, completed_at = NOW(), updated_at = NOW() WHERE id = $2",
        [result.hash, paymentId],
      );
    }
  }

  await AuditLoggerService.logEvent({
    level: LogLevel.INFO,
    action: AuditAction.PAYMENT_PROCESSED,
    message: `Stellar transaction confirmed: ${result.hash}`,
    userId,
    entityType: "payment",
    entityId: paymentId ?? result.hash,
    metadata: { hash: result.hash, ledger: result.ledger },
  });
}

export const stellarTxWorker = new Worker<StellarTxJobData>(
  QUEUE_NAMES.STELLAR_TX,
  processStellarTx,
  {
    connection: redisConnection,
    concurrency: CONCURRENCY.STELLAR_TX,
  },
);

stellarTxWorker.on("completed", (job) => {
  logger.info("Stellar TX job completed", {
    jobId: job.id,
    paymentId: job.data.paymentId,
  });
});

stellarTxWorker.on("failed", (job, err) => {
  const isExhausted = (job?.attemptsMade ?? 0) >= (job?.opts?.attempts ?? 40);
  const level = isExhausted ? "error" : "warn";

  logger[level]("Stellar TX job failed", {
    jobId: job?.id,
    paymentId: job?.data?.paymentId,
    attempt: job?.attemptsMade,
    maxAttempts: job?.opts?.attempts,
    error: err.message,
  });

  if (isExhausted && job?.data?.paymentId) {
    AuditLoggerService.logEvent({
      level: LogLevel.ERROR,
      action: AuditAction.PAYMENT_PROCESSED,
      message: `Stellar TX unconfirmed after max attempts for payment ${job.data.paymentId}`,
      userId: job.data.userId,
      entityType: "payment",
      entityId: job.data.paymentId,
      metadata: { error: err.message },
    }).catch(() => {});
  }
});

stellarTxWorker.on("error", (err) => {
  logger.error("Stellar TX worker error", { error: err.message });
});
