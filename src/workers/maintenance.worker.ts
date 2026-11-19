import { Worker, Job } from "bullmq";
import { redisConnection, QUEUE_NAMES, CONCURRENCY } from "../config/queue";
import { runMaintenanceTasks } from "./scheduler";
import { VerificationService } from "../services/verification.service";
import { AuditLogArchivalJob } from "../jobs/auditLog.job";
import keyRotationJob from "../jobs/keyRotation.job";
import recommendationStatsJob from "../jobs/recommendationStats.job";
import { runLeaderboardPrecompute } from "../jobs/leaderboardPrecompute.job";
import { runStreakTracking } from "../jobs/streakTracking.job";
import { WalletReconciliationService } from "../services/wallet-reconciliation.service";
import { PaymentReconciliationService } from "../services/payment-reconciliation.service";
import { logger } from "../utils/logger.utils";

async function processMaintenanceJob(job: Job): Promise<void> {
  if (job.name === "verification-retry-scheduled") {
    logger.info("[MaintenanceWorker] Running on-chain verification retry", {
      jobId: job.id,
    });
    await VerificationService.retryPendingOnChainVerifications();
    return;
  }

  if (job.name === "audit-log-archival-scheduled") {
    logger.info("[MaintenanceWorker] Running audit log archival", {
      jobId: job.id,
    });
    await AuditLogArchivalJob.run();
    return;
  }

  if (job.name === "key-rotation-scheduled") {
    logger.info("[MaintenanceWorker] Running key rotation", {
      jobId: job.id,
    });
    await keyRotationJob.runJwtRotation();
    return;
  }

  if (job.name === "recommendation-stats-scheduled") {
    logger.info("[MaintenanceWorker] Running recommendation stats refresh", {
      jobId: job.id,
    });
    await recommendationStatsJob.refresh();
    return;
  }

  if (job.name === "leaderboard-precompute-scheduled") {
    logger.info("[MaintenanceWorker] Running nightly leaderboard pre-computation", {
      jobId: job.id,
    });
    const result = await runLeaderboardPrecompute();
    logger.info("[MaintenanceWorker] Leaderboard pre-computation complete", result);
    return;
  }

  if (job.name === "streak-tracking-scheduled") {
    logger.info("[MaintenanceWorker] Running daily streak tracking", {
      jobId: job.id,
    });
    const result = await runStreakTracking();
    logger.info("[MaintenanceWorker] Streak tracking complete", result);
    return;
  }

  if (job.name === "wallet-reconciliation-scheduled") {
    await handleWalletReconciliation(job);
    return;
  }

  if (job.name === "payment-reconciliation-scheduled") {
    await handlePaymentReconciliation(job);
    return;
  }

  logger.info("[MaintenanceWorker] Running maintenance tasks", { jobId: job.id });
  await runMaintenanceTasks();
}

async function handleWalletReconciliation(job: Job): Promise<void> {
  logger.info("[MaintenanceWorker] Running wallet reconciliation sweep", {
    jobId: job.id,
  });
  const result = await WalletReconciliationService.reconcileAll();
  logger.info("[MaintenanceWorker] Wallet reconciliation sweep complete", result);
}

async function handlePaymentReconciliation(job: Job): Promise<void> {
  logger.info("[MaintenanceWorker] Running payment reconciliation sweep", {
    jobId: job.id,
  });
  const result = await PaymentReconciliationService.runNightlyReconciliation();
  logger.info("[MaintenanceWorker] Payment reconciliation sweep complete", result);
}

export const maintenanceWorker = new Worker(
  QUEUE_NAMES.MAINTENANCE,
  processMaintenanceJob,
  { connection: redisConnection, concurrency: CONCURRENCY.MAINTENANCE },
);

maintenanceWorker.on("completed", (job) => {
  logger.info("[MaintenanceWorker] Job completed", { jobId: job.id });
});

maintenanceWorker.on("failed", (job, err) => {
  logger.error("[MaintenanceWorker] Job failed", {
    jobId: job?.id,
    attempt: job?.attemptsMade,
    error: err.message,
  });
});

maintenanceWorker.on("error", (err) => {
  logger.error("[MaintenanceWorker] Worker error", { error: err.message });
});
