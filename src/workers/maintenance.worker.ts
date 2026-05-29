import { Worker, Job } from "bullmq";
import { redisConnection, QUEUE_NAMES, CONCURRENCY } from "../config/queue";
import { runMaintenanceTasks } from "./scheduler";
import { logger } from "../utils/logger.utils";

async function processMaintenanceJob(job: Job): Promise<void> {
  logger.info("[MaintenanceWorker] Running maintenance tasks", { jobId: job.id });
  await runMaintenanceTasks();
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
