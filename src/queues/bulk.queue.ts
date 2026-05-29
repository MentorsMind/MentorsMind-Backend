import { Queue, Worker, Job } from "bullmq";
import config from "../config";
import { BulkService } from "../services/bulk.service";
import { BulkJobModel } from "../models/bulk-job.model";
import { logger } from "../utils/logger.utils";

const redisUrl = config.redis.url || "redis://localhost:6379";
const url = new URL(redisUrl);

const connection = {
  host: url.hostname,
  port: parseInt(url.port, 10) || 6379,
  password: url.password || undefined,
};

export const bulkQueue = new Queue("bulk-queue", { connection });

export const bulkWorker = new Worker(
  "bulk-queue",
  async (job: Job) => {
    const { jobId, jobType, payload } = job.data;
    await BulkService.processJob(jobId, jobType, payload);
  },
  { connection, concurrency: 2 },
);

bulkWorker.on("completed", (job) => {
  logger.info("Bulk job completed", { jobId: job.data.jobId });
});

bulkWorker.on("failed", async (job, err) => {
  logger.error("Bulk job failed", {
    jobId: job?.data?.jobId,
    error: err.message,
  });
  if (job?.data?.jobId) {
    await BulkJobModel.updateStatus(job.data.jobId, "failed", {
      errorMessage: err.message,
    });
  }
});
