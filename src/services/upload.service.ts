/**
 * UploadService
 *
 * Wraps StorageService to provide avatar-specific upload logic:
 *  - MIME type validation (image/jpeg, image/png, image/webp)
 *  - 5 MB file-size guard
 *  - Sharp-based resize/compress to 256×256 JPEG
 *  - Unique S3 key generation: avatars/<userId>/<timestamp>.jpg
 *  - CloudFront / S3 HTTPS URL stored in the database (never base64)
 *  - Old S3 object deleted on replacement
 *  - Virus-scan job enqueued via the existing VIRUS_SCAN queue
 */

import { StorageService } from './storage.service';
import { ImageOptimizationService } from './image-optimization.service';
import { virusScanQueue } from '../queues/virus-scan.queue';
import { logger } from '../utils/logger.utils';
import { env } from '../config/env';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Allowed MIME types for avatar uploads */
export const ALLOWED_AVATAR_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

/** Maximum file size allowed before processing (5 MB) */
export const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

/** Target output dimensions in pixels */
const AVATAR_WIDTH = 256;
const AVATAR_HEIGHT = 256;

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class UnsupportedMediaTypeError extends Error {
  readonly statusCode = 415;
  constructor(mime: string) {
    super(
      `Unsupported media type "${mime}". Allowed types: image/jpeg, image/png, image/webp.`,
    );
    this.name = 'UnsupportedMediaTypeError';
  }
}

export class FileTooLargeError extends Error {
  readonly statusCode = 413;
  constructor(sizeBytes: number) {
    super(
      `File size ${Math.round(sizeBytes / 1024)} KB exceeds the 5 MB limit.`,
    );
    this.name = 'FileTooLargeError';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the S3 object key from an existing avatar_url so we can delete it.
 * Handles both:
 *   - CloudFront URLs: https://<dist>.cloudfront.net/avatars/<userId>/<ts>.jpg
 *   - S3 HTTPS URLs:   https://<bucket>.s3.<region>.amazonaws.com/avatars/...
 */
function extractS3KeyFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    // Strip the leading '/'
    const rawPath = parsed.pathname.replace(/^\//, '');
    // Only treat it as a valid internal key when the path starts with 'avatars/'
    if (rawPath.startsWith('avatars/')) {
      return rawPath;
    }
  } catch {
    // not a valid URL — could be a legacy base64 string; ignore
  }
  return null;
}

/**
 * Builds the public HTTPS URL for an S3 key.
 * Uses CDN_BASE_URL when set, otherwise falls back to a direct S3 HTTPS URL.
 */
function buildPublicUrl(key: string): string {
  const cdnBase = env.CDN_BASE_URL;
  if (cdnBase) {
    return `${cdnBase.replace(/\/$/, '')}/${key}`;
  }
  const bucket = env.AWS_S3_BUCKET;
  const region = env.AWS_REGION;
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

// ---------------------------------------------------------------------------
// UploadService
// ---------------------------------------------------------------------------

export const UploadService = {
  /**
   * Process and upload a user avatar to S3.
   *
   * @param userId        - Authenticated user's ID (used as part of the S3 key)
   * @param fileBuffer    - Raw file bytes received from multer
   * @param mimeType      - MIME type reported by multer (validated here as well)
   * @param sizeBytes     - File size in bytes (validated before sharp processing)
   * @param oldAvatarUrl  - Current avatar_url from the DB (if any); deleted from S3 when set
   * @returns             The public HTTPS URL to store in avatar_url
   */
  async uploadAvatar(
    userId: string,
    fileBuffer: Buffer,
    mimeType: string,
    sizeBytes: number,
    oldAvatarUrl: string | null,
  ): Promise<string> {
    // ── 1. Validate MIME type ────────────────────────────────────────────────
    if (!ALLOWED_AVATAR_MIME_TYPES.has(mimeType)) {
      throw new UnsupportedMediaTypeError(mimeType);
    }

    // ── 2. Validate file size ────────────────────────────────────────────────
    if (sizeBytes > MAX_AVATAR_SIZE_BYTES) {
      throw new FileTooLargeError(sizeBytes);
    }

    // ── 3. Optimize image with WebP conversion ───────────────────────────────
    const processedBuffer = await ImageOptimizationService.optimizeImage(fileBuffer, {
      width: AVATAR_WIDTH,
      height: AVATAR_HEIGHT,
      format: 'webp',
      quality: 80,
    });

    // ── 4. Generate a unique S3 key ─────────────────────────────────────────
    const timestamp = Date.now();
    const s3Key = `avatars/${userId}/${timestamp}.webp`;

    // ── 5. Upload to S3 ─────────────────────────────────────────────────────
    await StorageService.uploadFile(s3Key, processedBuffer, 'image/webp', {
      userId,
      uploadedAt: new Date().toISOString(),
    });

    logger.info('[UploadService] Avatar uploaded to S3', { userId, s3Key });

    // ── 6. Build the public HTTPS URL ────────────────────────────────────────
    const publicUrl = buildPublicUrl(s3Key);

    // ── 7. Delete the previous avatar from S3 (if applicable) ───────────────
    if (oldAvatarUrl) {
      const oldKey = extractS3KeyFromUrl(oldAvatarUrl);
      if (oldKey) {
        StorageService.deleteFile(oldKey).catch((err) => {
          // Log the failure but do not surface it to the caller —
          // the new avatar has already been saved successfully.
          logger.warn('[UploadService] Failed to delete old avatar from S3', {
            userId,
            oldKey,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
    }

    // ── 8. Enqueue virus scan ────────────────────────────────────────────────
    try {
      await virusScanQueue.add(
        'avatar-scan',
        {
          storageKey: s3Key,
          bucket: env.AWS_S3_BUCKET,
          // avatarId is not a DB table row; the worker uses it only for logging
          attachmentId: `avatar:${userId}`,
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 50 },
        },
      );
    } catch (err) {
      // Non-fatal — upload and DB update must still succeed even if queuing fails
      logger.warn('[UploadService] Failed to enqueue virus scan job', {
        userId,
        s3Key,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return publicUrl;
  },
};
