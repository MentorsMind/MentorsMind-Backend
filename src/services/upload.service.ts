import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import pool from "../config/database";
import { createError } from "../middleware/errorHandler";
import { logger } from "../utils/logger.utils";
import { resizeAvatar } from "../utils/image.utils";
import { env } from "../config/env";

// ---------------------------------------------------------------------------
// StorageBackend interface
// ---------------------------------------------------------------------------

interface StorageBackend {
  put(key: string, buffer: Buffer, mimeType: string): Promise<string>; // returns CDN URL
  delete(key: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// LocalStorageBackend
// ---------------------------------------------------------------------------

class LocalStorageBackend implements StorageBackend {
  private readonly uploadDir: string;

  constructor(uploadDir: string) {
    this.uploadDir = uploadDir;
  }

  async put(key: string, buffer: Buffer, _mimeType: string): Promise<string> {
    const filePath = path.join(this.uploadDir, key);
    const dir = path.dirname(filePath);

    // Create directory if it doesn't exist
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(filePath, buffer);

    return `${env.CDN_BASE_URL}/${key}`;
  }

  async delete(key: string): Promise<void> {
    const filePath = path.join(this.uploadDir, key);
    try {
      await fs.promises.unlink(filePath);
    } catch (err: unknown) {
      // Ignore file-not-found errors during cleanup
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// S3StorageBackend
// ---------------------------------------------------------------------------

class S3StorageBackend implements StorageBackend {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    this.client = new S3Client({
      region: env.AWS_REGION,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY!,
      },
    });
    this.bucket = env.S3_BUCKET_NAME!;
  }

  async put(key: string, buffer: Buffer, mimeType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      }),
    );
    return `${env.CDN_BASE_URL}/${key}`;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// generateFileKey
// ---------------------------------------------------------------------------

export function generateFileKey(prefix: "avatars" | "documents"): string {
  return `${prefix}/${uuidv4()}`;
}

// ---------------------------------------------------------------------------
// Storage backend selection (at module init)
// ---------------------------------------------------------------------------

function createStorageBackend(): StorageBackend {
  if (env.STORAGE_BACKEND === "s3") {
    return new S3StorageBackend();
  }
  return new LocalStorageBackend(env.LOCAL_UPLOAD_DIR);
}

const storage: StorageBackend = createStorageBackend();

// ---------------------------------------------------------------------------
// UploadResult
// ---------------------------------------------------------------------------

export interface UploadResult {
  fileKey: string;
  cdnUrl: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

// ---------------------------------------------------------------------------
// FileUploadRecord
// ---------------------------------------------------------------------------

export interface FileUploadRecord {
  id: string;
  fileKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploaderId: string;
  cdnUrl: string;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// UploadService
// ---------------------------------------------------------------------------

export const UploadService = {
  /**
   * Upload an avatar image: resize → store → persist metadata.
   * Compensating transaction: if DB insert fails, delete the stored file.
   */
  async uploadAvatar(
    file: Express.Multer.File,
    uploaderId: string,
  ): Promise<UploadResult> {
    // Process image
    let processedBuffer: Buffer;
    try {
      processedBuffer = await resizeAvatar(file.buffer, file.mimetype);
    } catch (err) {
      logger.error("Image processing failed", { error: err });
      throw createError("Image processing failed", 500);
    }

    const fileKey = generateFileKey("avatars");

    // Write to storage — 503 if unavailable
    let cdnUrl: string;
    try {
      cdnUrl = await storage.put(fileKey, processedBuffer, file.mimetype);
    } catch (err) {
      logger.error("Storage backend unavailable during avatar upload", {
        error: err,
      });
      throw createError("Storage backend unavailable", 503);
    }

    // Persist metadata — compensating transaction on failure
    try {
      await pool.query(
        `INSERT INTO file_uploads (file_key, original_name, mime_type, size_bytes, uploader_id, cdn_url)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          fileKey,
          file.originalname,
          file.mimetype,
          processedBuffer.length,
          uploaderId,
          cdnUrl,
        ],
      );
    } catch (err) {
      logger.error(
        "DB insert failed after storage write; rolling back storage object",
        {
          fileKey,
          error: err,
        },
      );
      await storage.delete(fileKey).catch((deleteErr) => {
        logger.error("Failed to delete storage object during rollback", {
          fileKey,
          error: deleteErr,
        });
      });
      throw createError("Failed to persist file metadata", 500);
    }

    return {
      fileKey,
      cdnUrl,
      originalName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: processedBuffer.length,
    };
  },

  /**
   * Upload a document (PDF): store → persist metadata.
   * No image processing. Same compensating transaction pattern.
   */
  async uploadDocument(
    file: Express.Multer.File,
    uploaderId: string,
  ): Promise<UploadResult> {
    const fileKey = generateFileKey("documents");

    // Write to storage — 503 if unavailable
    let cdnUrl: string;
    try {
      cdnUrl = await storage.put(fileKey, file.buffer, file.mimetype);
    } catch (err) {
      logger.error("Storage backend unavailable during document upload", {
        error: err,
      });
      throw createError("Storage backend unavailable", 503);
    }

    // Persist metadata — compensating transaction on failure
    try {
      await pool.query(
        `INSERT INTO file_uploads (file_key, original_name, mime_type, size_bytes, uploader_id, cdn_url)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          fileKey,
          file.originalname,
          file.mimetype,
          file.size,
          uploaderId,
          cdnUrl,
        ],
      );
    } catch (err) {
      logger.error(
        "DB insert failed after storage write; rolling back storage object",
        {
          fileKey,
          error: err,
        },
      );
      await storage.delete(fileKey).catch((deleteErr) => {
        logger.error("Failed to delete storage object during rollback", {
          fileKey,
          error: deleteErr,
        });
      });
      throw createError("Failed to persist file metadata", 500);
    }

    return {
      fileKey,
      cdnUrl,
      originalName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
    };
  },

  /**
   * Delete a file: look up by key → delete from storage → delete DB record.
   */
  async deleteFile(fileKey: string): Promise<void> {
    // Look up metadata
    const result = await pool.query<{ file_key: string }>(
      `SELECT file_key FROM file_uploads WHERE file_key = $1`,
      [fileKey],
    );

    if (result.rows.length === 0) {
      throw createError("File not found", 404);
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Delete from storage
      await storage.delete(fileKey);

      // Delete DB record
      await client.query(`DELETE FROM file_uploads WHERE file_key = $1`, [
        fileKey,
      ]);

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      logger.error("Failed to delete file", { fileKey, error: err });
      throw err;
    } finally {
      client.release();
    }
  },
};
