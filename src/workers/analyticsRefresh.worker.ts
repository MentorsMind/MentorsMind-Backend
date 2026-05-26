import { Worker, Job } from "bullmq";
import { redisConnection } from "../queues/queue.config";
import {
  ANALYTICS_REFRESH_QUEUE,
  AnalyticsRefreshJobData,
} from "../queues/analyticsRefresh.queue";
import { AnalyticsService } from "../services/analytics.service";
import { logger } from "../utils/logger.utils";

async function processAnalyticsRefreshJob(
  job: Job<AnalyticsRefreshJobData>,
): Promise<void> {
  logger.info(
    "[AnalyticsRefreshWorker] Refreshing analytics materialized views",
    { jobId: job.id },
  );
  await AnalyticsService.refreshViews();
  logger.info(
    "[AnalyticsRefreshWorker] Analytics materialized views refreshed",
  );
}

export const analyticsRefreshWorker = new Worker<AnalyticsRefreshJobData>(
  ANALYTICS_REFRESH_QUEUE,
  processAnalyticsRefreshJob,
  { connection: redisConnection, concurrency: 1 },
);

analyticsRefreshWorker.on("completed", (job) => {
  logger.info("[AnalyticsRefreshWorker] Job completed", { jobId: job.id });
});

analyticsRefreshWorker.on("failed", (job, err) => {
  logger.error("[AnalyticsRefreshWorker] Job failed", {
    jobId: job?.id,
    attempt: job?.attemptsMade,
    error: err.message,
  });
});

analyticsRefreshWorker.on("error", (err) => {
  logger.error("[AnalyticsRefreshWorker] Worker error", { error: err.message });
});
