/**
 * worker-bootstrap.ts — Standalone worker process entry point
 *
 * Deploy this as a SEPARATE Railway service ("Worker" service) so that
 * BullMQ workers run independently from the HTTP API, allowing each to
 * scale and restart without affecting the other.
 *
 * Railway service command:  node dist/worker-bootstrap.js
 */
import { loadSecrets } from "./config/secrets";

async function startWorkers() {
  // Load secrets (AWS / Vault / env) before any queue/worker modules are imported
  await loadSecrets();

  // Initialise OTel before queue/worker modules are imported so auto-
  // instrumentations (pg, ioredis, http) patch modules at load time.
  const { initTracing } = await import("./config/tracing");
  initTracing();

  // Dynamic import ensures config/env.ts is validated AFTER secrets are merged
  const { logger } = await import("./utils/logger.utils");

  logger.info("[WorkerProcess] Secrets loaded — initialising BullMQ workers");

  const {
    emailWorker,
    paymentWorker,
    escrowReleaseWorker,
    reportWorker,
    sessionReminderWorker,
    stellarTxWorker,
    escrowCheckWorker,
    notificationsWorker,
    notificationCleanupWorker,
    maintenanceWorker,
    webhookDeliveryWorker,
    transcriptionWorker,
    qualityScoreWorker,
    onboardingNudgeWorker,
    taxReportingWorker,
    startScheduler,
    stopScheduler,
    startOutboxWorker,
    stopOutboxWorker,
  } = await import("./workers");

  await startScheduler();
  await startOutboxWorker();

  logger.info("[WorkerProcess] All workers and scheduler started", {
    workers: [
      "email",
      "payment",
      "escrowRelease",
      "report",
      "sessionReminder",
      "stellarTx",
      "escrowCheck",
      "notifications",
      "notificationCleanup",
      "maintenance",
      "webhookDelivery",
      "transcription",
      "qualityScore",
      "onboardingNudge",
      "taxReporting",
    ],
  });

  // Graceful shutdown — Railway sends SIGTERM before terminating the container
  async function shutdown(signal: string) {
    logger.info({ signal }, "[WorkerProcess] Shutting down workers gracefully");

    await Promise.all([
      emailWorker.close(),
      paymentWorker.close(),
      escrowReleaseWorker.close(),
      reportWorker.close(),
      sessionReminderWorker.close(),
      stellarTxWorker.close(),
      escrowCheckWorker.close(),
      notificationsWorker.close(),
      notificationCleanupWorker.close(),
      maintenanceWorker.close(),
      webhookDeliveryWorker.close(),
      transcriptionWorker.close(),
      qualityScoreWorker.close(),
      onboardingNudgeWorker.close(),
      taxReportingWorker.close(),
      stopScheduler(),
    ]);

    logger.info("[WorkerProcess] All workers closed — exiting");
    process.exit(0);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

startWorkers().catch((err) => {
  process.stderr.write(`[WorkerProcess] Fatal error: ${err}\n`);
  process.exit(1);
});
