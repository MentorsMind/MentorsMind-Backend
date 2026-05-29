import path from "path";
import crypto from "crypto";
import pool from "../config/database";
import { SocketService } from "./socket.service";
import { MessagingService } from "./messaging.service";
import { logger } from "../utils/logger.utils";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { virusScanQueue } from "../queues/virus-scan.queue";

const s3 = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
  },
});

const DAILY_QUOTA_BYTES = 50 * 1024 * 1024; // 50 MB

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ALLOWED_DOC_TYPES = ["application/pdf"];
const IMAGE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const DOC_MAX_BYTES = 20 * 1024 * 1024; // 20 MB

export interface AttachmentRecord {
  id: string;
  message_id: string;
  conversation_id: string;
  uploader_id: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  storage_key: string;
  storage_bucket: string;
  scan_status: "pending" | "clean" | "infected" | "error";
  scanned_at: Date | null;
  created_at: Date;
  signed_url?: string;
}

export const AttachmentService = {
  /**
   * Validate file type and size.
   * Returns an error string or null if valid.
   */
  validateFile(mimeType: string, fileSize: number): string | null {
    if (ALLOWED_IMAGE_TYPES.includes(mimeType)) {
      if (fileSize > IMAGE_MAX_BYTES) return "Image exceeds 10 MB limit";
      return null;
    }
    if (ALLOWED_DOC_TYPES.includes(mimeType)) {
      if (fileSize > DOC_MAX_BYTES) return "Document exceeds 20 MB limit";
      return null;
    }
    return `Unsupported file type: ${mimeType}. Allowed: JPEG, PNG, WebP, PDF`;
  },

  /**
   * Atomically check and increment the daily upload quota.
   * Returns false if the quota would be exceeded.
   *
   * Two-step approach that eliminates the optimistic-increment-then-rollback race:
   *   1. Conditional UPDATE — only increments when bytes_used + fileSize <= quota.
   *      If the row is missing (first upload today) or quota is full, no row is touched.
   *   2. INSERT for the first-upload-of-day case — ON CONFLICT DO NOTHING ensures
   *      that if another request already inserted the row (race on first upload),
   *      we correctly treat it as quota-exceeded rather than double-counting.
   */
  async checkAndUpdateQuota(
    userId: string,
    fileSize: number,
  ): Promise<boolean> {
    // Step 1: increment only when it won't exceed the quota (atomic, no rollback needed).
    const { rows: updated } = await pool.query<{ bytes_used: string }>(
      `UPDATE user_upload_quotas
       SET bytes_used = bytes_used + $2
       WHERE user_id = $1
         AND quota_date = CURRENT_DATE
         AND bytes_used + $2 <= $3
       RETURNING bytes_used`,
      [userId, fileSize, DAILY_QUOTA_BYTES],
    );

    if (updated.length > 0) return true;

    // Step 2: UPDATE found no row — either the row doesn't exist yet (first upload
    // today) or the quota is already met.  Attempt an insert; DO NOTHING on conflict
    // so a concurrent first-upload doesn't double-count.
    const { rows: inserted } = await pool.query<{ bytes_used: string }>(
      `INSERT INTO user_upload_quotas (user_id, quota_date, bytes_used)
       VALUES ($1, CURRENT_DATE, $2)
       ON CONFLICT (user_id, quota_date) DO NOTHING
       RETURNING bytes_used`,
      [userId, fileSize],
    );

    // Inserted → first upload of the day, within quota.
    // Conflict (no rows returned) → row already existed but the conditional UPDATE
    // above didn't fire, meaning the quota is already reached or exceeded.
    return inserted.length > 0;
  },

  /**
   * Persist a file to S3.
   */
  async storeFile(
    fileBuffer: Buffer,
    originalName: string,
  ): Promise<{ storageKey: string; bucket: string }> {
    const ext = path.extname(originalName) || "";
    const storageKey = `${crypto.randomUUID()}${ext}`;
    const bucket = process.env.AWS_S3_BUCKET || "attachments";

    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: storageKey,
        Body: fileBuffer,
      }),
    );

    logger.debug("AttachmentService: file stored to S3", { storageKey });

    return { storageKey, bucket };
  },

  /**
   * Generate a signed URL valid for 1 hour using AWS SDK.
   */
  async generateSignedUrl(storageKey: string, bucket: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: storageKey,
    });
    return getSignedUrl(s3, command, { expiresIn: 3600 });
  },

  /**
   * Upload a file attachment to a conversation.
   * Validates → checks quota → stores → creates message → saves metadata with pending status → queues async scan.
   */
  async uploadAttachment(
    conversationId: string,
    uploaderId: string,
    fileBuffer: Buffer,
    originalName: string,
    mimeType: string,
  ): Promise<{ attachment: AttachmentRecord; message: any } | null> {
    const validationError = this.validateFile(mimeType, fileBuffer.length);
    if (validationError) throw new Error(validationError);

    const withinQuota = await this.checkAndUpdateQuota(
      uploaderId,
      fileBuffer.length,
    );
    if (!withinQuota)
      throw new Error("Daily upload quota exceeded (50 MB/day)");

    const { storageKey, bucket } = await this.storeFile(
      fileBuffer,
      originalName,
    );

    // Create a message whose body is the file name
    const message = await MessagingService.sendMessage(
      conversationId,
      uploaderId,
      `📎 ${originalName}`,
    );

    if (!message) {
      // Clean up orphaned file
      try {
        await s3.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: storageKey }),
        );
      } catch (err) {
        logger.warn("Failed to cleanup orphaned file", { err });
      }
      return null;
    }

    // Store attachment with pending scan status
    const { rows } = await pool.query<AttachmentRecord>(
      `INSERT INTO message_attachments
         (message_id, conversation_id, uploader_id, file_name, file_size,
          mime_type, storage_key, storage_bucket, scan_status, scanned_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', NULL)
       RETURNING *`,
      [
        message.id,
        conversationId,
        uploaderId,
        originalName,
        fileBuffer.length,
        mimeType,
        storageKey,
        bucket,
      ],
    );

    const attachment = rows[0];

    // Queue async virus scan job
    await virusScanQueue.add("scan-file", {
      attachmentId: attachment.id,
      storageKey,
      bucket,
    });

    logger.info("[AttachmentService] File uploaded, virus scan queued", {
      attachmentId: attachment.id,
      uploaderId,
    });

    // Emit attachment notification to recipient (without signed URL until scan completes)
    const conv = await MessagingService.getConversation(
      conversationId,
      uploaderId,
    );
    if (conv) {
      const recipientId =
        conv.participant_one_id === uploaderId
          ? conv.participant_two_id
          : conv.participant_one_id;

      SocketService.emitToUser(recipientId, "message:new", {
        conversationId,
        message,
        attachment: {
          id: attachment.id,
          file_name: attachment.file_name,
          file_size: attachment.file_size,
          mime_type: attachment.mime_type,
          scan_status: attachment.scan_status,
        },
      });
    }

    return { attachment, message };
  },

  /**
   * Delete attachment files from storage when the parent message is deleted.
   */
  async deleteAttachmentsByMessage(messageId: string): Promise<void> {
    const { rows } = await pool.query<AttachmentRecord>(
      `SELECT * FROM message_attachments WHERE message_id = $1`,
      [messageId],
    );

    for (const att of rows) {
      try {
        await s3.send(
          new DeleteObjectCommand({
            Bucket: att.storage_bucket,
            Key: att.storage_key,
          }),
        );
      } catch (err) {
        logger.warn("AttachmentService: failed to delete file from S3", {
          storageKey: att.storage_key,
          err,
        });
      }
    }

    await pool.query(`DELETE FROM message_attachments WHERE message_id = $1`, [
      messageId,
    ]);
  },

  /**
   * Get attachment with signed URL only if scan status is clean.
   */
  async getAttachmentWithUrl(
    attachmentId: string,
  ): Promise<AttachmentRecord | null> {
    const { rows } = await pool.query<AttachmentRecord>(
      `SELECT * FROM message_attachments WHERE id = $1`,
      [attachmentId],
    );

    const attachment = rows[0] || null;
    if (!attachment) return null;

    // Only generate signed URL if scan is clean
    if (attachment.scan_status === "clean") {
      attachment.signed_url = await this.generateSignedUrl(
        attachment.storage_key,
        attachment.storage_bucket,
      );
    }

    return attachment;
  },

  /**
   * Notify uploader when scan completes via WebSocket.
   */
  async notifyScanComplete(
    attachmentId: string,
    scanStatus: "clean" | "infected" | "error",
  ): Promise<void> {
    const { rows } = await pool.query<AttachmentRecord>(
      `SELECT * FROM message_attachments WHERE id = $1`,
      [attachmentId],
    );

    const attachment = rows[0];
    if (!attachment) return;

    let signedUrl: string | undefined;
    if (scanStatus === "clean") {
      signedUrl = await this.generateSignedUrl(
        attachment.storage_key,
        attachment.storage_bucket,
      );
    }

    SocketService.emitToUser(
      attachment.uploader_id,
      "attachment:scan_complete",
      {
        attachmentId: attachment.id,
        scanStatus,
        signedUrl,
        file_name: attachment.file_name,
      },
    );

    logger.info("[AttachmentService] Scan complete notification sent", {
      attachmentId,
      scanStatus,
      uploaderId: attachment.uploader_id,
    });
  },
};
