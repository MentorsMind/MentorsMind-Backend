import { Worker, Job } from "bullmq";
import { createManagedQueue, enableJobResultCache } from "./queue.manager";
import { QUEUE_NAMES, redisConnection } from "./queue.config";
import { ExportFormat } from "../models/export-job.model";
import { runDataExportJob } from "../jobs/dataExport.job";
import { EarningsReportService } from "../services/earningsReport.service";
import { ExportJobModel } from "../models/export-job.model";
import { AuditLoggerService } from "../services/audit-logger.service";
import { LogLevel } from "../utils/log-formatter.utils";
import { Logger } from "../utils/logger.utils";

export interface ExportJobData {
  userId: string;
  jobId: string;
  requestId?: string;           // legacy compat
  type?: "earnings-export" | "data-export";
  format?: ExportFormat;
  period?: string;
  startDate?: string;
  endDate?: string;
}

export const exportQueue = createManagedQueue<ExportJobData>(QUEUE_NAMES.EXPORT);
// Cache export job results for monitoring and UI lookups.
enableJobResultCache(exportQueue, 3600);

export const exportWorker = new Worker<ExportJobData>(
  QUEUE_NAMES.EXPORT,
  async (job: Job<ExportJobData>) => {
    const { userId, jobId, type } = job.data;

    if (type === "earnings-export") {
      const { format, period, startDate, endDate } = job.data;
      await EarningsReportService.processQueuedExport(
        jobId,
        userId,
        (format ?? "csv") as "csv" | "pdf",
        period || "30d",
        startDate,
        endDate,
      );
    } else {
      // Full GDPR data export â€” delegates to dataExport.job.ts
      await runDataExportJob(job as any);
    }
  },
  { connection: redisConnection, concurrency: 5 },
);

exportWorker.on("completed", (job) => {
  logger.info(`[ExportWorker] Job ${job.id} completed`, {
    jobId: job.data.jobId,
    userId: job.data.userId,
    type: job.data.type ?? "data-export",
  });
});

exportWorker.on("failed", async (job, err) => {
  logger.error(`[ExportWorker] Job ${job?.id} failed`, { error: err.message });
  if (job) {
    const { jobId, userId } = job.data;
    try {
      await ExportJobModel.updateStatus(jobId, "failed", undefined, err.message);
      await AuditLoggerService.logEvent({
        level: LogLevel.ERROR,
        action: "DATA_EXPORT_FAILED",
        message: `Data export failed for user ${userId}: ${err.message}`,
        userId,
        entityType: "export_job",
        entityId: jobId,
        metadata: { error: err.message },
      });
    } catch (logErr) {
      logger.error("[ExportWorker] Failed to update job status after failure", { logErr });
    }
  }
});

