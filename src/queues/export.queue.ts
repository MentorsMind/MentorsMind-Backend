import { Queue, Worker, Job } from 'bullmq';
import config from '../config';
import { ExportService } from '../services/export.service';
import { EarningsReportService } from '../services/earningsReport.service';
import { ExportJobModel } from '../models/export-job.model';
import { AuditLoggerService } from '../services/audit-logger.service';
import { LogLevel } from '../utils/log-formatter.utils';
import { logger } from '../utils/logger';

const redisUrl = config.redis.url || 'redis://localhost:6379';
const url = new URL(redisUrl);

const connection = {
  host: url.hostname,
  port: parseInt(url.port, 10) || 6379,
  password: url.password || undefined,
};

export const exportQueue = new Queue("export-queue", { connection });

export const exportWorker = new Worker(
  "export-queue",
  async (job: Job) => {
    const { userId, jobId, type } = job.data;
    
    if (type === 'earnings-export') {
      const { format, period, startDate, endDate } = job.data;
      await EarningsReportService.processQueuedExport(jobId, userId, format, period, startDate, endDate);
    } else {
      // Regular data export
      await ExportService.processExport(userId, jobId);
    }
  },
  { connection, concurrency: 5 },
);

exportWorker.on("completed", (job) => {
  logger.info(`Export job ${job.id} completed`);
});

exportWorker.on("failed", async (job, err) => {
  logger.error(`Export job ${job?.id} failed`, { error: err.message });
  if (job) {
    const { jobId, userId } = job.data;
    await ExportJobModel.updateStatus(jobId, "failed", undefined, err.message);

    await AuditLoggerService.logEvent({
      level: LogLevel.ERROR,
      action: "DATA_EXPORT_FAILED",
      message: `Data export failed for user ${userId}: ${err.message}`,
      userId: userId,
      entityType: "export_job",
      entityId: jobId,
      metadata: { error: err.message },
    });
  }
});
