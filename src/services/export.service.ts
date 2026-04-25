import fs from "fs";
import path from "path";
import archiver from "archiver";
import { ExportJobModel } from "../models/export-job.model";
import { SessionModel } from "../models/session.model";
import { PaymentModel } from "../models/payment.model";
import { ReviewModel } from "../models/review.model";
import { UsersService } from "./users.service";
import { exportQueue } from "../queues/export.queue";
import { AuditLoggerService } from "./audit-logger.service";
import { LogLevel } from "../utils/log-formatter.utils";
import { StorageService } from "./storage.service";

function toExportSafeRecord(user: any): any {
  const safeUser = { ...user };
  delete safeUser.password_hash;
  delete safeUser.refresh_token;
  delete safeUser.reset_token;
  return safeUser;
}

export const ExportService = {
  async requestExport(userId: string): Promise<string> {
    const job = await ExportJobModel.create(userId);
    await exportQueue.add("process-export", { userId, jobId: job.id });

    await AuditLoggerService.logEvent({
      level: LogLevel.INFO,
      action: "DATA_EXPORT_REQUESTED",
      message: `User ${userId} requested data export`,
      userId: userId,
      entityType: "export_job",
      entityId: job.id,
      metadata: {},
    });

    return job.id;
  },

  async processExport(userId: string, jobId: string): Promise<void> {
    let tempFilePath: string | null = null;
    try {
      await ExportJobModel.updateStatus(jobId, "processing");

      const user = await UsersService.findById(userId);
      const sessions = await SessionModel.findByUserId(userId);
      const payments = await PaymentModel.findByUserId(userId);
      const reviews = await ReviewModel.findByUserId(userId);

      const fileName = `export_${userId}_${Date.now()}.zip`;
      const timestamp = Date.now();
      tempFilePath = path.join(process.cwd(), "temp", fileName);

      // Ensure temp directory exists
      const tempDir = path.dirname(tempFilePath);
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const output = fs.createWriteStream(tempFilePath);
      const archive = archiver("zip", { zlib: { level: 9 } });

      archive.pipe(output);

      // Add profile with sensitive fields stripped
      const safeUser = toExportSafeRecord(user);
      archive.append(JSON.stringify(safeUser, null, 2), {
        name: "profile.json",
      });

      // Add sessions
      archive.append(JSON.stringify(sessions, null, 2), {
        name: "sessions.json",
      });
      archive.append(this.jsonToCsv(sessions), { name: "sessions.csv" });

      // Add payments
      archive.append(JSON.stringify(payments, null, 2), {
        name: "payments.json",
      });
      archive.append(this.jsonToCsv(payments), { name: "payments.csv" });

      // Add reviews
      archive.append(JSON.stringify(reviews, null, 2), {
        name: "reviews.json",
      });
      archive.append(this.jsonToCsv(reviews), { name: "reviews.csv" });

      await archive.finalize();

      // Wait for the write stream to finish
      await new Promise<void>((resolve, reject) => {
        output.on("finish", resolve);
        output.on("error", reject);
      });

      // Read the file buffer
      const fileBuffer = fs.readFileSync(tempFilePath);

      // Upload to S3
      const s3Key = StorageService.buildExportKey(userId, jobId, timestamp);
      const result = await StorageService.uploadFile(
        s3Key,
        fileBuffer,
        "application/zip",
        { userId, fileName },
      );

      // Store the S3 key (not local path) in the database
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);

      await ExportJobModel.updateStatus(
        jobId,
        "completed",
        result.key,
        undefined,
        expiresAt,
      );

      // Delete the local temp file after successful S3 upload
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }

      await AuditLoggerService.logEvent({
        level: LogLevel.INFO,
        action: "DATA_EXPORT_COMPLETED",
        message: `Data export completed for user ${userId}`,
        userId: userId,
        entityType: "export_job",
        entityId: jobId,
        metadata: { fileName, s3Key: result.key, expiresAt, s3Url: result.url },
      });
    } catch (error: any) {
      // Cleanup: delete the local temp file on failure
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }

      // Mark the job as failed
      await ExportJobModel.updateStatus(
        jobId,
        "failed",
        undefined,
        error.message,
      );

      await AuditLoggerService.logEvent({
        level: LogLevel.ERROR,
        action: "DATA_EXPORT_FAILED",
        message: `Data export failed for user ${userId}: ${error.message}`,
        userId: userId,
        entityType: "export_job",
        entityId: jobId,
        metadata: { error: error.message },
      });

      throw error;
    }
  },

  async getEarningsExport(
    mentorId: string,
    from?: string,
    to?: string,
  ): Promise<{ data: string; fileName: string }> {
    const earnings = await PaymentModel.findEarningsByMentorId(
      mentorId,
      from,
      to,
    );
    const csv = this.jsonToCsv(earnings);
    const fileName = `earnings_${mentorId}_${Date.now()}.csv`;

    await AuditLoggerService.logEvent({
      level: LogLevel.INFO,
      action: "EARNINGS_EXPORT_GENERATED",
      message: `Mentor ${mentorId} generated earnings export`,
      userId: mentorId,
      entityType: "mentor",
      entityId: mentorId,
      metadata: { from, to },
    });

    return { data: csv, fileName };
  },

  async getJobStatus(jobId: string, userId: string) {
    const job = await ExportJobModel.findById(jobId);
    if (!job || job.user_id !== userId) {
      return null;
    }
    return job;
  },

  jsonToCsv(items: any[]): string {
    if (items.length === 0) return "";
    const replacer = (_key: string, value: any) =>
      value === null ? "" : value;
    const header = Object.keys(items[0]);
    const csv = [
      header.join(","),
      ...items.map((row) =>
        header
          .map((fieldName) =>
            JSON.stringify(row[fieldName], replacer)
              .replace(/\n/g, "\\n")
              .replace(/\r/g, "\\r"),
          )
          .join(","),
      ),
    ].join("\r\n");
    return csv;
  },
};
