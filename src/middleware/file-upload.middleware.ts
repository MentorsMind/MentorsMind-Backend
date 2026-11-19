/**
 * File Upload Security Middleware
 *
 * Wraps multer with comprehensive security controls:
 *  - File-type validation (allow-list per route category)
 *  - Magic-byte (file signature) inspection
 *  - Per-category size limits
 *  - Blocked extension enforcement
 *  - Async virus-scan queue integration
 *  - Secure S3 upload with quarantine staging
 *
 * Usage:
 *   import { createUploadMiddleware } from './file-upload.middleware';
 *
 *   router.post(
 *     '/avatar',
 *     authenticate,
 *     createUploadMiddleware('avatar'),
 *     avatarController.upload,
 *   );
 */

import { Request, Response, NextFunction } from 'express';
import multer, { FileFilterCallback } from 'multer';
import { AuthenticatedRequest } from './auth.middleware';
import {
  FileSecurityService,
  AllowedFileCategory,
} from '../services/file-security.service';
import { logger } from '../utils/logger.utils';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Augmented file object with security metadata attached by this middleware */
export interface SecureFile extends Express.Multer.File {
  /** SHA-256 of the file buffer */
  checksum: string;
  /** Category used for validation */
  category: AllowedFileCategory;
  /** MIME type detected from magic bytes */
  detectedMimeType: string | null;
  /** S3 key where the file was uploaded (quarantine) */
  s3Key?: string;
  /** S3 bucket (quarantine) */
  s3Bucket?: string;
  /** Publicly accessible URL of the quarantined file */
  s3Url?: string;
  /** BullMQ scan job ID */
  scanJobId?: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      secureFile?: SecureFile;
      secureFiles?: SecureFile[];
    }
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ALLOWED_MIME_TYPES: Record<AllowedFileCategory, string[]> = {
  avatar: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  document: [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  attachment: [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'text/plain',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
  ],
  certificate: ['application/pdf', 'image/jpeg', 'image/png'],
};

const MAX_SIZES_BYTES: Record<AllowedFileCategory, number> = {
  avatar: 5 * 1024 * 1024,
  document: 20 * 1024 * 1024,
  attachment: 50 * 1024 * 1024,
  certificate: 10 * 1024 * 1024,
};

const MAX_FILES_PER_REQUEST = 5;

// ─── Multer factory ───────────────────────────────────────────────────────────

/**
 * Build a multer instance for the given file category.
 * Uses memory storage so we can inspect the buffer before uploading to S3.
 */
function buildMulter(category: AllowedFileCategory) {
  const allowedMimes = new Set(ALLOWED_MIME_TYPES[category]);

  const fileFilter = (
    _req: Request,
    file: Express.Multer.File,
    cb: FileFilterCallback,
  ): void => {
    if (allowedMimes.has(file.mimetype)) {
      cb(null, true);
    } else {
      // Pass an Error — multer will reject this file
      cb(
        new Error(
          `MIME type "${file.mimetype}" is not allowed for ${category} uploads.`,
        ),
      );
    }
  };

  return multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: MAX_SIZES_BYTES[category],
      files: MAX_FILES_PER_REQUEST,
    },
    fileFilter,
  });
}

// ─── Middleware factory ───────────────────────────────────────────────────────

/**
 * Create a composed middleware chain that:
 *   1. Runs multer (size limit, MIME filter)
 *   2. Performs deep validation (magic bytes, extension block-list)
 *   3. Uploads to quarantine S3 bucket
 *   4. Enqueues virus scan
 *   5. Attaches `req.secureFile` / `req.secureFiles` for controllers
 *
 * @param category - file category controlling allow-list and size limits
 * @param field    - multer field name (default: 'file')
 * @param multi    - true to accept multiple files under `field`
 */
export function createUploadMiddleware(
  category: AllowedFileCategory,
  field = 'file',
  multi = false,
) {
  const upload = buildMulter(category);
  const multerMw = multi
    ? upload.array(field, MAX_FILES_PER_REQUEST)
    : upload.single(field);

  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    // Step 1: run multer
    multerMw(req, res, async (multerErr: any) => {
      if (multerErr) {
        const isFileTooLarge =
          multerErr.code === 'LIMIT_FILE_SIZE' ||
          multerErr.message?.includes('File too large');

        if (isFileTooLarge) {
          res.status(413).json({
            success: false,
            error: `File too large. Maximum size for ${category} is ${(MAX_SIZES_BYTES[category] / 1024 / 1024).toFixed(0)} MB.`,
            errorCode: 'FILE_TOO_LARGE',
          });
          return;
        }

        res.status(415).json({
          success: false,
          error: multerErr.message || 'Unsupported file type.',
          errorCode: 'UNSUPPORTED_FILE_TYPE',
        });
        return;
      }

      // Step 2: collect uploaded files
      const rawFiles: Express.Multer.File[] = multi
        ? ((req.files as Express.Multer.File[]) ?? [])
        : req.file
          ? [req.file]
          : [];

      if (!rawFiles.length) {
        res.status(400).json({
          success: false,
          error: `No file received for field "${field}".`,
          errorCode: 'NO_FILE_UPLOADED',
        });
        return;
      }

      try {
        const userId = req.user?.userId;
        if (!userId) {
          res.status(401).json({ success: false, error: 'Not authenticated.' });
          return;
        }

        const processed: SecureFile[] = [];

        for (const file of rawFiles) {
          // Step 3: deep validation
          const validation = FileSecurityService.validateFile(
            file.buffer,
            file.mimetype,
            file.originalname,
            category,
          );

          if (!validation.valid) {
            logger.warn('createUploadMiddleware: file validation failed', {
              userId,
              category,
              errors: validation.errors,
              originalName: file.originalname,
            });

            res.status(422).json({
              success: false,
              error: validation.errors.join(' '),
              errorCode: 'FILE_VALIDATION_FAILED',
              details: validation.errors,
            });
            return;
          }

          // Step 4: upload to quarantine + enqueue scan
          let uploadResult;
          try {
            uploadResult = await FileSecurityService.uploadToQuarantine({
              buffer: file.buffer,
              mimeType: file.mimetype,
              originalName: file.originalname,
              category,
              userId,
            });
          } catch (uploadErr: any) {
            logger.error('createUploadMiddleware: S3 upload failed', {
              userId,
              error: uploadErr.message,
            });
            // Proceed without S3 in dev/test environments
            if (process.env.NODE_ENV === 'production') {
              res.status(500).json({
                success: false,
                error: 'File storage unavailable. Please try again.',
                errorCode: 'STORAGE_ERROR',
              });
              return;
            }
            // Non-production: attach empty S3 metadata
            uploadResult = {
              key: `local/${userId}/${Date.now()}-${file.originalname}`,
              bucket: 'local',
              url: '',
              checksum: FileSecurityService.computeChecksum(file.buffer),
              scanJobId: null,
              sizeBytes: file.buffer.length,
              mimeType: file.mimetype,
              detectedMimeType: validation.detectedMimeType,
            };
          }

          const secureFile: SecureFile = {
            ...file,
            checksum: uploadResult.checksum,
            category,
            detectedMimeType: uploadResult.detectedMimeType,
            s3Key: uploadResult.key,
            s3Bucket: uploadResult.bucket,
            s3Url: uploadResult.url,
            scanJobId: uploadResult.scanJobId,
          };

          processed.push(secureFile);
        }

        // Step 5: attach to request
        if (multi) {
          req.secureFiles = processed;
        } else {
          req.secureFile = processed[0];
        }

        return next();
      } catch (err: any) {
        logger.error('createUploadMiddleware: unexpected error', {
          error: err.message,
          userId: req.user?.userId,
        });
        res.status(500).json({
          success: false,
          error: 'File upload processing failed.',
          errorCode: 'UPLOAD_PROCESSING_ERROR',
        });
      }
    });
  };
}

// ─── Convenience pre-configured middlewares ───────────────────────────────────

/**
 * Ready-made middleware for avatar uploads (single file, field = 'avatar').
 */
export const uploadAvatarMiddleware = createUploadMiddleware('avatar', 'avatar');

/**
 * Ready-made middleware for document uploads (single file, field = 'document').
 */
export const uploadDocumentMiddleware = createUploadMiddleware('document', 'document');

/**
 * Ready-made middleware for up to 5 attachment files (field = 'attachments').
 */
export const uploadAttachmentsMiddleware = createUploadMiddleware(
  'attachment',
  'attachments',
  true,
);

/**
 * Ready-made middleware for certificate uploads (single file, field = 'certificate').
 */
export const uploadCertificateMiddleware = createUploadMiddleware(
  'certificate',
  'certificate',
);
