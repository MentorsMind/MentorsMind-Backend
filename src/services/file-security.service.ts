/**
 * FileSecurityService
 *
 * Comprehensive file upload security service providing:
 *  - Deep MIME-type validation (magic-byte inspection, not just extension)
 *  - File size enforcement
 *  - Secure storage via S3 with server-side encryption
 *  - Pre-signed URL generation for time-limited access
 *  - Async virus scanning via the existing virus-scan BullMQ queue
 *  - Quarantine bucket isolation until scan passes
 *  - Upload audit logging
 */

import crypto from 'crypto';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { logger } from '../utils/logger.utils';
import { env } from '../config/env';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AllowedFileCategory = 'avatar' | 'document' | 'attachment' | 'certificate';

export interface FileValidationResult {
  valid: boolean;
  mimeType: string | null;
  detectedMimeType: string | null;
  size: number;
  errors: string[];
}

export interface SecureUploadResult {
  /** S3 object key in the quarantine bucket (pre-scan) or primary bucket (post-scan) */
  key: string;
  /** Bucket that holds the file */
  bucket: string;
  /** Public-accessible URL (if CloudFront) or S3 HTTPS URL */
  url: string;
  /** SHA-256 hash of the original file for integrity verification */
  checksum: string;
  /** BullMQ job ID for the virus scan */
  scanJobId: string | null;
  /** File size in bytes */
  sizeBytes: number;
  /** MIME type as declared and as detected */
  mimeType: string;
  detectedMimeType: string | null;
}

export interface SignedUrlOptions {
  /** How long the URL is valid (seconds). Default: 3600 (1 hour) */
  expiresIn?: number;
  /** Optional custom filename sent to the browser via Content-Disposition */
  downloadName?: string;
}

// ─── Configuration ────────────────────────────────────────────────────────────

/** Allowed MIME types per category with their magic-byte signatures */
const ALLOWED_TYPES: Record<AllowedFileCategory, Set<string>> = {
  avatar: new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  document: new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ]),
  attachment: new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'text/plain',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
  ]),
  certificate: new Set(['application/pdf', 'image/jpeg', 'image/png']),
};

/** Maximum file sizes per category (bytes) */
const MAX_SIZES: Record<AllowedFileCategory, number> = {
  avatar: 5 * 1024 * 1024,       // 5 MB
  document: 20 * 1024 * 1024,    // 20 MB
  attachment: 50 * 1024 * 1024,  // 50 MB
  certificate: 10 * 1024 * 1024, // 10 MB
};

/**
 * Magic byte signatures for reliable MIME-type detection.
 * Checked against the first bytes of the file buffer.
 */
const MAGIC_BYTES: Array<{ mime: string; bytes: number[]; offset?: number }> = [
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 },   // RIFF
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] },          // %PDF
  { mime: 'application/zip', bytes: [0x50, 0x4b, 0x03, 0x04] },          // PK (DOCX/XLSX)
];

// Blocked MIME types regardless of category (executable / script types)
const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.sh', '.ps1', '.msi', '.dll', '.so',
  '.vbs', '.js', '.ts', '.py', '.rb', '.php', '.pl', '.cgi',
  '.htaccess', '.env', '.config',
]);

// ─── S3 client ────────────────────────────────────────────────────────────────

const s3 = new S3Client({
  region: (env as any).AWS_REGION || process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: (env as any).AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: (env as any).AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

const PRIMARY_BUCKET: string =
  (env as any).AWS_S3_BUCKET || process.env.AWS_S3_BUCKET || 'mentorminds-uploads';

const QUARANTINE_BUCKET: string =
  (env as any).AWS_S3_QUARANTINE_BUCKET ||
  process.env.AWS_S3_QUARANTINE_BUCKET ||
  `${PRIMARY_BUCKET}-quarantine`;

const CLOUDFRONT_DOMAIN: string | undefined =
  (env as any).AWS_CLOUDFRONT_DOMAIN || process.env.AWS_CLOUDFRONT_DOMAIN;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function detectMimeFromBuffer(buffer: Buffer): string | null {
  for (const sig of MAGIC_BYTES) {
    const offset = sig.offset ?? 0;
    const matches = sig.bytes.every(
      (byte, idx) => buffer[offset + idx] === byte,
    );
    if (matches) return sig.mime;
  }
  return null;
}

function buildS3Key(
  category: AllowedFileCategory,
  userId: string,
  originalName: string,
): string {
  const sanitized = path
    .basename(originalName)
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .toLowerCase();
  const timestamp = Date.now();
  const uniqueId = uuidv4().replace(/-/g, '').slice(0, 12);
  return `${category}s/${userId}/${timestamp}-${uniqueId}-${sanitized}`;
}

function buildPublicUrl(bucket: string, key: string): string {
  if (CLOUDFRONT_DOMAIN) {
    return `https://${CLOUDFRONT_DOMAIN}/${key}`;
  }
  const region =
    (env as any).AWS_REGION || process.env.AWS_REGION || 'us-east-1';
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export const FileSecurityService = {
  /**
   * Validate a file buffer for the given category.
   *
   * Checks:
   *  - File size against category limit
   *  - Declared MIME type against allow-list
   *  - Magic bytes match declared MIME type
   *  - File extension is not blocked
   */
  validateFile(
    buffer: Buffer,
    declaredMime: string,
    originalName: string,
    category: AllowedFileCategory,
  ): FileValidationResult {
    const errors: string[] = [];

    // 1. Size check
    const maxSize = MAX_SIZES[category];
    if (buffer.length > maxSize) {
      errors.push(
        `File size ${(buffer.length / 1024 / 1024).toFixed(1)} MB exceeds the ${(maxSize / 1024 / 1024).toFixed(0)} MB limit for ${category}.`,
      );
    }

    // 2. Extension block-list
    const ext = path.extname(originalName).toLowerCase();
    if (BLOCKED_EXTENSIONS.has(ext)) {
      errors.push(`File extension "${ext}" is not allowed.`);
    }

    // 3. Declared MIME type against allow-list
    const allowed = ALLOWED_TYPES[category];
    if (!allowed.has(declaredMime)) {
      errors.push(
        `MIME type "${declaredMime}" is not permitted for ${category} uploads.`,
      );
    }

    // 4. Magic-byte inspection
    const detectedMime = detectMimeFromBuffer(buffer);
    if (detectedMime && detectedMime !== declaredMime) {
      // Allow application/zip as underlying format for docx/xlsx
      const zipBased = new Set([
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
      ]);
      if (!(detectedMime === 'application/zip' && zipBased.has(declaredMime))) {
        errors.push(
          `File content does not match declared type. Declared: "${declaredMime}", Detected: "${detectedMime}".`,
        );
      }
    }

    return {
      valid: errors.length === 0,
      mimeType: declaredMime,
      detectedMimeType: detectedMime,
      size: buffer.length,
      errors,
    };
  },

  /**
   * Upload a file to S3 quarantine bucket (pending virus scan).
   *
   * The file lands in the quarantine bucket first.  Once the virus-scan
   * queue worker clears the file it should be moved to the primary bucket
   * via `approveQuarantinedFile`.
   *
   * @returns SecureUploadResult with the quarantine key and scan job ID
   */
  async uploadToQuarantine(params: {
    buffer: Buffer;
    mimeType: string;
    originalName: string;
    category: AllowedFileCategory;
    userId: string;
    metadata?: Record<string, string>;
  }): Promise<SecureUploadResult> {
    const key = buildS3Key(params.category, params.userId, params.originalName);
    const checksum = crypto
      .createHash('sha256')
      .update(params.buffer)
      .digest('hex');

    await s3.send(
      new PutObjectCommand({
        Bucket: QUARANTINE_BUCKET,
        Key: key,
        Body: params.buffer,
        ContentType: params.mimeType,
        ServerSideEncryption: 'AES256',
        Metadata: {
          'x-upload-checksum': checksum,
          'x-upload-user': params.userId,
          'x-upload-category': params.category,
          ...(params.metadata ?? {}),
        },
      }),
    );

    // Enqueue virus scan
    let scanJobId: string | null = null;
    try {
      const { virusScanQueue } = await import('../queues/virus-scan.queue');
      const job = await virusScanQueue.add('scan', {
        storageKey: key,
        bucket: QUARANTINE_BUCKET,
        userId: params.userId,
        checksum,
        category: params.category,
      });
      scanJobId = String(job.id);
    } catch (err: any) {
      logger.warn('FileSecurityService: could not enqueue virus scan', {
        key,
        error: err.message,
      });
    }

    const url = buildPublicUrl(QUARANTINE_BUCKET, key);

    logger.info('FileSecurityService: file uploaded to quarantine', {
      key,
      userId: params.userId,
      category: params.category,
      sizeBytes: params.buffer.length,
      scanJobId,
    });

    return {
      key,
      bucket: QUARANTINE_BUCKET,
      url,
      checksum,
      scanJobId,
      sizeBytes: params.buffer.length,
      mimeType: params.mimeType,
      detectedMimeType: detectMimeFromBuffer(params.buffer),
    };
  },

  /**
   * Move a quarantined file to the primary bucket after a clean scan result.
   * Called by the virus-scan worker when the file passes.
   */
  async approveQuarantinedFile(key: string): Promise<{ url: string }> {
    await s3.send(
      new CopyObjectCommand({
        Bucket: PRIMARY_BUCKET,
        Key: key,
        CopySource: `${QUARANTINE_BUCKET}/${key}`,
        ServerSideEncryption: 'AES256',
      }),
    );

    // Delete from quarantine
    await s3.send(
      new DeleteObjectCommand({
        Bucket: QUARANTINE_BUCKET,
        Key: key,
      }),
    );

    const url = buildPublicUrl(PRIMARY_BUCKET, key);

    logger.info('FileSecurityService: quarantined file approved', { key });
    return { url };
  },

  /**
   * Permanently delete a quarantined file that failed the virus scan.
   */
  async rejectQuarantinedFile(key: string, reason: string): Promise<void> {
    await s3.send(
      new DeleteObjectCommand({
        Bucket: QUARANTINE_BUCKET,
        Key: key,
      }),
    );

    logger.warn('FileSecurityService: quarantined file rejected and deleted', {
      key,
      reason,
    });
  },

  /**
   * Generate a time-limited pre-signed URL for private S3 objects.
   *
   * Use this for serving documents / certificates that should not be
   * publicly accessible via permanent URLs.
   */
  async generateSignedUrl(
    key: string,
    options: SignedUrlOptions = {},
  ): Promise<string> {
    const expiresIn = options.expiresIn ?? 3600;
    const bucket = PRIMARY_BUCKET;

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ...(options.downloadName
        ? {
            ResponseContentDisposition: `attachment; filename="${options.downloadName}"`,
          }
        : {}),
    });

    const signedUrl = await getSignedUrl(s3, command, { expiresIn });

    logger.info('FileSecurityService: signed URL generated', {
      key,
      expiresIn,
    });

    return signedUrl;
  },

  /**
   * Delete a file from the primary bucket.
   */
  async deleteFile(key: string): Promise<void> {
    await s3.send(
      new DeleteObjectCommand({
        Bucket: PRIMARY_BUCKET,
        Key: key,
      }),
    );
    logger.info('FileSecurityService: file deleted', { key });
  },

  /**
   * Compute SHA-256 checksum of a buffer for integrity verification.
   */
  computeChecksum(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  },

  /**
   * Build a safe, de-duped S3 key from user context and original filename.
   * Exposed for external use when custom key paths are needed.
   */
  buildKey(
    category: AllowedFileCategory,
    userId: string,
    originalName: string,
  ): string {
    return buildS3Key(category, userId, originalName);
  },
};

export default FileSecurityService;
