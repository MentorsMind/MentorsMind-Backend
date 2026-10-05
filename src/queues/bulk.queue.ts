import { Queue, Worker, Job } from "bullmq";
import config from "../config";
import { BulkService } from "../services/bulk.service";
import { BulkJobModel } from "../models/bulk-job.model";
import { logger } from "../utils/logger.utils";

import { redisConnection } from "../queues/queue.config";

export const bulkQueue = new Queue("bulk-queue", { connection: redisConnection });

export const bulkWorker = new Worker(
  "bulk-queue",
  async (job: Job) => {
    const { jobId, jobType, payload, requestedBy } = job.data;
    await BulkService.processJob(jobId, jobType, payload, requestedBy);
  },
  { 
    connection: redisConnection, 
    concurrency: 2,
    limiter: {
      max: 100,
      duration: 1000,
    }
  },
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
