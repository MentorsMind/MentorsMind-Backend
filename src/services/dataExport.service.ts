import fs from "fs";
import path from "path";
import archiver from "archiver";
import crypto from "crypto";
import pool from "../config/database";
import {
  DataExportRequestModel,
  DataExportRequest,
} from "../models/data-export-request.model";
import { UsersService } from "./users.service";
import { exportQueue } from "../queues/export.queue";
import { AuditLoggerService } from "./audit-logger.service";
import { LogLevel, AuditAction } from "../utils/log-formatter.utils";
import { emailService } from "./email.service";
import config from "../config";

const EXPORT_DIR = path.join(process.cwd(), "exports");

if (!fs.existsSync(EXPORT_DIR)) {
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
}

export const DataExportService = {
  async requestExport(userId: string): Promise<DataExportRequest> {
    // 1. Check rate limit (1 per 30 days)
    const latestRequest =
      await DataExportRequestModel.findLatestByUserId(userId);
    if (latestRequest) {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      if (
        latestRequest.requested_at > thirtyDaysAgo &&
        latestRequest.status !== "failed"
      ) {
        throw new Error("You can only request one data export every 30 days.");
      }
    }

    // 2. Create request record
    const request = await DataExportRequestModel.create(userId);

    // 3. Queue job
    await exportQueue.add("process-data-export", {
      userId,
      requestId: request.id,
    });

    // 4. Audit log
    await AuditLoggerService.logEvent({
      level: LogLevel.INFO,
      action: AuditAction.ADMIN_ACTION, // or generic action
      message: `User ${userId} requested GDPR data export`,
      userId: userId,
      entityType: "data_export_request",
      entityId: request.id,
      metadata: {},
    });

    return request;
  },

  async getExportStatus(userId: string): Promise<DataExportRequest | null> {
    return DataExportRequestModel.findLatestByUserId(userId);
  },

  async processExport(userId: string, requestId: string): Promise<void> {
    try {
      await DataExportRequestModel.updateStatus(requestId, "processing");

      const userData = await this.collectUserData(userId);

      const fileName = `data_export_${userId}_${Date.now()}.zip`;
      const filePath = path.join(EXPORT_DIR, fileName);
      const output = fs.createWriteStream(filePath);
      const archive = archiver("zip", { zlib: { level: 9 } });

      const archivePromise = new Promise((resolve, reject) => {
        output.on("close", resolve);
        archive.on("error", reject);
      });

      archive.pipe(output);

      // Add each data category as a JSON file
      for (const [category, data] of Object.entries(userData)) {
        archive.append(JSON.stringify(data, null, 2), {
          name: `${category}.json`,
        });
      }

      await archive.finalize();
      await archivePromise;

      const stats = fs.statSync(filePath);
      const checksum = crypto
        .createHash("sha256")
        .update(fs.readFileSync(filePath))
        .digest("hex");
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 48); // 48h expiry

      await DataExportRequestModel.updateStatus(requestId, "completed", {
        filePath,
        fileSize: stats.size,
        checksum,
        processedAt: new Date(),
        expiresAt,
      });

      // Send email
      const user = await UsersService.findById(userId);
      if (user) {
        const downloadUrl = `${config.server.apiVersion}/users/me/data-export/download/${requestId}`; // Simplified
        await emailService.sendEmail({
          to: [user.email],
          subject: "Your Data Export is Ready",
          htmlContent: `
                        <p>Hi ${user.first_name},</p>
                        <p>Your personal data export is ready for download.</p>
                        <p>This link will expire in 48 hours.</p>
                        <p><a href="${downloadUrl}">Download My Data</a></p>
                        <p>If you didn't request this, please contact support.</p>
                    `,
        });
      }

      await AuditLoggerService.logEvent({
        level: LogLevel.INFO,
        action: AuditAction.ADMIN_ACTION,
        message: `Data export completed for user ${userId}`,
        userId: userId,
        entityType: "data_export_request",
        entityId: requestId,
        metadata: { fileName, fileSize: stats.size },
      });
    } catch (error: any) {
      await DataExportRequestModel.updateStatus(requestId, "failed", {
        errorMessage: error.message,
      });
      throw error;
    }
  },

  async collectUserData(userId: string): Promise<Record<string, any>> {
    const [
      profile,
      bookings,
      messages,
      transactions,
      reviews,
      notes,
      auditLogs,
    ] = await Promise.all([
      UsersService.findById(userId),
      this.fetchBookings(userId),
      this.fetchMessages(userId),
      this.fetchTransactions(userId),
      this.fetchReviews(userId),
      this.fetchNotes(userId),
      this.fetchAuditLogs(userId),
    ]);

    return {
      profile,
      bookings,
      messages,
      transactions,
      reviews,
      notes,
      auditLogs,
    };
  },

  async fetchBookings(userId: string) {
    const { rows } = await pool.query(
      "SELECT * FROM bookings WHERE mentee_id = $1 OR mentor_id = $1",
      [userId],
    );
    return rows;
  },

  async fetchMessages(userId: string) {
    const { rows } = await pool.query(
      "SELECT * FROM messages WHERE sender_id = $1",
      [userId],
    );
    return rows;
  },

  async fetchTransactions(userId: string) {
    const { rows } = await pool.query(
      "SELECT * FROM transactions WHERE user_id = $1",
      [userId],
    );
    return rows;
  },

  async fetchReviews(userId: string) {
    const { rows } = await pool.query(
      "SELECT * FROM reviews WHERE reviewer_id = $1 OR reviewee_id = $1",
      [userId],
    );
    return rows;
  },

  async fetchNotes(userId: string) {
    const { rows } = await pool.query(
      "SELECT * FROM booking_notes WHERE author_id = $1",
      [userId],
    );
    return rows;
  },

  async fetchAuditLogs(userId: string) {
    const { rows } = await pool.query(
      "SELECT * FROM audit_logs WHERE user_id = $1",
      [userId],
    );
    return rows;
  },
};
