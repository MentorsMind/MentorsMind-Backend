import { Worker, Job } from "bullmq";
import { redisConnection } from "../queues/queue.config";
import {
  ACCOUNT_DELETION_QUEUE,
  AccountDeletionJobData,
} from "../queues/accountDeletion.queue";
import { accountDeletionJob } from "../jobs/accountDeletion.job";
import { logger } from "../utils/logger.utils";

async function processAccountDeletionJob(
  job: Job<AccountDeletionJobData>,
): Promise<void> {
  logger.info("[AccountDeletionWorker] Running account deletion job", {
    jobId: job.id,
  });
  const { processed } = await accountDeletionJob.run();
  logger.info("[AccountDeletionWorker] Account deletion job completed", {
    processed,
  });
}

export const accountDeletionWorker = new Worker<AccountDeletionJobData>(
  ACCOUNT_DELETION_QUEUE,
  processAccountDeletionJob,
  { connection: redisConnection, concurrency: 1 },
);

accountDeletionWorker.on("completed", (job) => {
  logger.info("[AccountDeletionWorker] Job completed", { jobId: job.id });
});

accountDeletionWorker.on("failed", (job, err) => {
  logger.error("[AccountDeletionWorker] Job failed", {
    jobId: job?.id,
    attempt: job?.attemptsMade,
    error: err.message,
  });
});

accountDeletionWorker.on("error", (err) => {
  logger.error("[AccountDeletionWorker] Worker error", { error: err.message });
});
