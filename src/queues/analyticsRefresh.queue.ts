import { Queue } from "bullmq";
import { redisConnection, defaultJobOptions } from "./queue.config";

export const ANALYTICS_REFRESH_QUEUE = "analytics-refresh-queue";

export interface AnalyticsRefreshJobData {
  jobType: "analytics-refresh";
}

export const analyticsRefreshQueue = new Queue<AnalyticsRefreshJobData>(
  ANALYTICS_REFRESH_QUEUE,
  { connection: redisConnection, defaultJobOptions },
);
