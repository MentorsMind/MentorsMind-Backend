/**
 * Recording Cleanup Job
 *
 * Runs weekly (Saturday 02:00 UTC) via BullMQ repeatable job.
 *
 * Responsibilities:
 *  1. List all S3 objects under the `recordings/` prefix (paginated).
 *  2. Cross-reference each key against the `session_recordings` table.
 *     Objects with no matching DB row are marked as orphans.
 *  3. List and abort all incomplete multipart uploads older than 24 hours.
 *  4. Soft-delete confirmed orphans: write a `recording_cleanup_log` row
 *     with deletion_status='pending_deletion' (7-day recovery window).
 *  5. Hard-delete objects whose soft-delete window has expired (>7 days old).
 *  6. Purge `recording_cleanup_log` rows older than 30 days.
 *  7. Return a cleanup report with stats and estimated cost savings.
 *
 * Safety guarantee: a valid `session_recordings` row in any non-deleted status
 * will NEVER cause its S3 key to be removed.
 */

import {
  S3Client,
  ListObjectsV2Command,
  ListObjectsV2CommandOutput,
  DeleteObjectCommand,
  ListMultipartUploadsCommand,
  AbortMultipartUploadCommand,
  _Object as S3Object,
} from '@aws-sdk/client-s3';
import { env } from '../config/env';
import { db } from '../config/database';
import { logger } from '../utils/logger.utils';
import { v4 as uuidv4 } from 'uuid';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CleanupReport {
  jobRunId: string;
  ranAt: string;

  // S3 object scan
  s3ObjectsScanned: number;
  orphansFound: number;
  orphansMarkedForDeletion: number;

  // Hard deletions (soft-delete window expired)
  hardDeletedObjects: number;
  hardDeletedBytes: number;

  // Multipart uploads
  incompleteMultipartUploadsFound: number;
  multipartUploadsAborted: number;

  // Log hygiene
  cleanupLogRowsPurged: number;

  // Cost estimate
  totalBytesReclaimed: number;
  estimatedMonthlySavingsUsd: number;

  // Errors (non-fatal)
  errors: string[];
}

interface OrphanCandidate {
  s3Key: string;
  sizeBytes: number;
  lastModified: Date;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** AWS S3 Standard storage cost per GB per month (as of 2024 first-50-TB tier). */
const S3_COST_PER_GB_PER_MONTH_USD = 0.023;

/** Soft-delete recovery window in days. */
const SOFT_DELETE_DAYS = 7;

/** How long to retain cleanup log rows (days). */
const LOG_RETENTION_DAYS = 30;

/** Minimum age in hours for an incomplete multipart upload to be aborted. */
const MULTIPART_MAX_AGE_HOURS = 24;

// ---------------------------------------------------------------------------
// S3 Client (lazy singleton — avoids cold init when env vars not set in tests)
// ---------------------------------------------------------------------------

let _s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!_s3Client) {
    _s3Client = new S3Client({
      region: env.AWS_REGION,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      },
    });
  }
  return _s3Client;
}

const BUCKET = env.AWS_S3_BUCKET;
const RECORDINGS_PREFIX = 'recordings/';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Collect all S3 object keys under the recordings/ prefix, paginating
 * through ListObjectsV2 continuation tokens.
 */
async function listAllRecordingObjects(): Promise<OrphanCandidate[]> {
  const objects: OrphanCandidate[] = [];
  let continuationToken: string | undefined;

  do {
    const command = new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: RECORDINGS_PREFIX,
      ContinuationToken: continuationToken,
    });

    const response: ListObjectsV2CommandOutput = await getS3Client().send(command);

    for (const obj of response.Contents ?? []) {
      if (obj.Key) {
        objects.push({
          s3Key: obj.Key,
          sizeBytes: obj.Size ?? 0,
          lastModified: obj.LastModified ?? new Date(0),
        });
      }
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return objects;
}

/**
 * Fetch the set of s3_keys that have an active (non-deleted) DB record.
 * We load all keys in one query to avoid N+1 lookups.
 */
async function loadActiveS3Keys(): Promise<Set<string>> {
  const { rows } = (await db.query(
    `SELECT s3_key FROM session_recordings WHERE status != 'deleted'`,
  )) as { rows: Array<{ s3_key: string }> };
  return new Set(rows.map((r) => r.s3_key));
}

/**
 * Load s3_keys that are already in the cleanup log with pending_deletion status,
 * so we don't double-log them on subsequent runs.
 */
async function loadPendingDeletionKeys(): Promise<Set<string>> {
  const { rows } = (await db.query(
    `SELECT s3_key FROM recording_cleanup_log WHERE deletion_status = 'pending_deletion'`,
  )) as { rows: Array<{ s3_key: string }> };
  return new Set(rows.map((r) => r.s3_key));
}

/**
 * Insert a batch of orphan candidates into recording_cleanup_log as pending_deletion.
 * Returns the count of rows inserted.
 */
async function markOrphansForDeletion(
  orphans: OrphanCandidate[],
  jobRunId: string,
): Promise<number> {
  if (orphans.length === 0) return 0;

  // Build a multi-row VALUES string for a single INSERT
  const values: unknown[] = [];
  const placeholders = orphans.map((o, i) => {
    const base = i * 5;
    values.push(o.s3Key, BUCKET, o.sizeBytes, jobRunId, 'orphan');
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
  });

  await db.query(
    `INSERT INTO recording_cleanup_log
       (s3_key, s3_bucket, file_size_bytes, job_run_id, cleanup_reason)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT DO NOTHING`,
    values,
  );

  return orphans.length;
}

/**
 * Hard-delete S3 objects whose soft-delete window (7 days) has elapsed.
 * Returns bytes reclaimed and count deleted.
 */
async function hardDeleteExpiredObjects(
  jobRunId: string,
): Promise<{ count: number; bytes: number }> {
  // Fetch rows ready for hard deletion
  const { rows } = (await db.query(
    `SELECT id, s3_key, file_size_bytes
     FROM recording_cleanup_log
     WHERE deletion_status = 'pending_deletion'
       AND scheduled_deletion_at <= NOW()`,
  )) as {
    rows: Array<{
      id: string;
      s3_key: string;
      file_size_bytes: string;
    }>;
  };

  if (rows.length === 0) return { count: 0, bytes: 0 };

  let deleted = 0;
  let bytesReclaimed = 0;

  for (const row of rows) {
    try {
      // Double-check: ensure no active DB record exists before deleting
      const { rows: activeRows } = (await db.query(
        `SELECT id FROM session_recordings
         WHERE s3_key = $1 AND status != 'deleted'
         LIMIT 1`,
        [row.s3_key],
      )) as { rows: Array<{ id: string }> };

      if (activeRows.length > 0) {
        // A live recording has appeared — skip and mark recovered to stop retrying
        logger.warn('[RecordingCleanup] Skipping hard delete — active DB record found', {
          s3Key: row.s3_key,
          recordingId: activeRows[0].id,
          jobRunId,
        });
        await db.query(
          `UPDATE recording_cleanup_log
           SET deletion_status = 'recovered', recovered_at = NOW()
           WHERE id = $1`,
          [row.id],
        );
        continue;
      }

      // Delete from S3
      await getS3Client().send(
        new DeleteObjectCommand({ Bucket: BUCKET, Key: row.s3_key }),
      );

      // Mark as deleted in the log
      await db.query(
        `UPDATE recording_cleanup_log
         SET deletion_status = 'deleted', deleted_at = NOW()
         WHERE id = $1`,
        [row.id],
      );

      deleted++;
      bytesReclaimed += parseInt(row.file_size_bytes, 10) || 0;

      logger.info('[RecordingCleanup] Hard deleted orphan S3 object', {
        s3Key: row.s3_key,
        bytes: row.file_size_bytes,
        jobRunId,
      });
    } catch (err) {
      logger.error('[RecordingCleanup] Failed to hard delete S3 object', {
        s3Key: row.s3_key,
        error: err instanceof Error ? err.message : String(err),
        jobRunId,
      });
      // Non-fatal — continue processing remaining rows
    }
  }

  return { count: deleted, bytes: bytesReclaimed };
}

/**
 * List and abort incomplete multipart uploads older than MULTIPART_MAX_AGE_HOURS.
 * Returns count of uploads aborted.
 */
async function abortIncompleteMultipartUploads(
  jobRunId: string,
  errors: string[],
): Promise<{ aborted: number; found: number }> {
  const cutoff = new Date(Date.now() - MULTIPART_MAX_AGE_HOURS * 60 * 60 * 1000);

  let keyMarker: string | undefined;
  let uploadIdMarker: string | undefined;
  let found = 0;
  let aborted = 0;

  do {
    const response = await getS3Client().send(
      new ListMultipartUploadsCommand({
        Bucket: BUCKET,
        Prefix: RECORDINGS_PREFIX,
        KeyMarker: keyMarker,
        UploadIdMarker: uploadIdMarker,
      }),
    );

    for (const upload of response.Uploads ?? []) {
      if (!upload.Key || !upload.UploadId || !upload.Initiated) continue;
      if (upload.Initiated > cutoff) continue; // Too recent — skip

      found++;

      try {
        await getS3Client().send(
          new AbortMultipartUploadCommand({
            Bucket: BUCKET,
            Key: upload.Key,
            UploadId: upload.UploadId,
          }),
        );

        // Log to cleanup table for audit trail
        await db.query(
          `INSERT INTO recording_cleanup_log
             (s3_key, s3_bucket, file_size_bytes, job_run_id, cleanup_reason,
              deletion_status, upload_id, upload_initiated_at, deleted_at)
           VALUES ($1, $2, 0, $3, 'incomplete_multipart', 'deleted', $4, $5, NOW())
           ON CONFLICT DO NOTHING`,
          [upload.Key, BUCKET, jobRunId, upload.UploadId, upload.Initiated],
        );

        aborted++;

        logger.info('[RecordingCleanup] Aborted incomplete multipart upload', {
          s3Key: upload.Key,
          uploadId: upload.UploadId,
          initiatedAt: upload.Initiated.toISOString(),
          jobRunId,
        });
      } catch (err) {
        const msg = `Failed to abort multipart upload ${upload.UploadId} for ${upload.Key}: ${
          err instanceof Error ? err.message : String(err)
        }`;
        errors.push(msg);
        logger.error('[RecordingCleanup] ' + msg, { jobRunId });
      }
    }

    if (response.IsTruncated) {
      keyMarker = response.NextKeyMarker;
      uploadIdMarker = response.NextUploadIdMarker;
    } else {
      keyMarker = undefined;
    }
  } while (keyMarker);

  return { aborted, found };
}

/**
 * Delete recording_cleanup_log rows older than LOG_RETENTION_DAYS that have
 * already been hard-deleted or recovered.
 */
async function purgeOldLogRows(): Promise<number> {
  const { rowCount } = await db.query(
    `DELETE FROM recording_cleanup_log
     WHERE deletion_status IN ('deleted', 'recovered')
       AND created_at < NOW() - ($1 || ' days')::INTERVAL`,
    [LOG_RETENTION_DAYS],
  );
  return rowCount ?? 0;
}

/**
 * Estimate monthly AWS S3 Standard cost for a given number of bytes.
 */
function estimateMonthlyCostUsd(bytes: number): number {
  const gb = bytes / (1024 * 1024 * 1024);
  return parseFloat((gb * S3_COST_PER_GB_PER_MONTH_USD).toFixed(4));
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run the full recording cleanup cycle.
 * Called by the BullMQ worker every Saturday at 02:00 UTC.
 */
export async function runRecordingCleanupJob(): Promise<CleanupReport> {
  const jobRunId = uuidv4();
  const ranAt = new Date().toISOString();
  const errors: string[] = [];

  logger.info('[RecordingCleanup] Job started', { jobRunId, ranAt });

  const report: CleanupReport = {
    jobRunId,
    ranAt,
    s3ObjectsScanned: 0,
    orphansFound: 0,
    orphansMarkedForDeletion: 0,
    hardDeletedObjects: 0,
    hardDeletedBytes: 0,
    incompleteMultipartUploadsFound: 0,
    multipartUploadsAborted: 0,
    cleanupLogRowsPurged: 0,
    totalBytesReclaimed: 0,
    estimatedMonthlySavingsUsd: 0,
    errors,
  };

  // ── Step 1: List all S3 objects under recordings/ ─────────────────────────
  let s3Objects: OrphanCandidate[] = [];
  try {
    s3Objects = await listAllRecordingObjects();
    report.s3ObjectsScanned = s3Objects.length;
    logger.info('[RecordingCleanup] S3 scan complete', {
      count: s3Objects.length,
      jobRunId,
    });
  } catch (err) {
    const msg = `S3 listing failed: ${err instanceof Error ? err.message : String(err)}`;
    errors.push(msg);
    logger.error('[RecordingCleanup] ' + msg, { jobRunId });
    // Cannot continue without the S3 list — return partial report
    report.errors = errors;
    return report;
  }

  // ── Step 2: Cross-reference against DB ────────────────────────────────────
  try {
    const [activeKeys, pendingKeys] = await Promise.all([
      loadActiveS3Keys(),
      loadPendingDeletionKeys(),
    ]);

    const newOrphans: OrphanCandidate[] = s3Objects.filter(
      (obj) => !activeKeys.has(obj.s3Key) && !pendingKeys.has(obj.s3Key),
    );

    report.orphansFound = s3Objects.filter((obj) => !activeKeys.has(obj.s3Key)).length;

    logger.info('[RecordingCleanup] Orphan analysis complete', {
      activeDbKeys: activeKeys.size,
      totalS3: s3Objects.length,
      orphansFound: report.orphansFound,
      newOrphans: newOrphans.length,
      jobRunId,
    });

    // ── Step 3: Soft-delete new orphans ─────────────────────────────────────
    report.orphansMarkedForDeletion = await markOrphansForDeletion(newOrphans, jobRunId);
  } catch (err) {
    const msg = `Orphan detection failed: ${err instanceof Error ? err.message : String(err)}`;
    errors.push(msg);
    logger.error('[RecordingCleanup] ' + msg, { jobRunId });
  }

  // ── Step 4: Hard-delete objects past the soft-delete window ───────────────
  try {
    const { count, bytes } = await hardDeleteExpiredObjects(jobRunId);
    report.hardDeletedObjects = count;
    report.hardDeletedBytes = bytes;
  } catch (err) {
    const msg = `Hard-delete phase failed: ${err instanceof Error ? err.message : String(err)}`;
    errors.push(msg);
    logger.error('[RecordingCleanup] ' + msg, { jobRunId });
  }

  // ── Step 5: Abort incomplete multipart uploads ────────────────────────────
  try {
    const { found, aborted } = await abortIncompleteMultipartUploads(jobRunId, errors);
    report.incompleteMultipartUploadsFound = found;
    report.multipartUploadsAborted = aborted;
  } catch (err) {
    const msg = `Multipart abort phase failed: ${err instanceof Error ? err.message : String(err)}`;
    errors.push(msg);
    logger.error('[RecordingCleanup] ' + msg, { jobRunId });
  }

  // ── Step 6: Purge old log rows ────────────────────────────────────────────
  try {
    report.cleanupLogRowsPurged = await purgeOldLogRows();
  } catch (err) {
    const msg = `Log purge failed: ${err instanceof Error ? err.message : String(err)}`;
    errors.push(msg);
    logger.error('[RecordingCleanup] ' + msg, { jobRunId });
  }

  // ── Step 7: Cost calculation ──────────────────────────────────────────────
  // Reclaimed = hard-deleted orphan bytes (multipart upload sizes are unknown pre-abort)
  const orphanBytesFromSoftDeleteCandidates = s3Objects
    .filter((obj) => {
      // Include bytes for objects we newly identified as orphans this run
      return true; // We'll calculate from the DB log instead
    })
    .reduce((sum) => sum, 0);

  // More accurate: query the cleanup log for total bytes of objects marked this run
  try {
    const { rows } = (await db.query(
      `SELECT COALESCE(SUM(file_size_bytes), 0)::text AS total
       FROM recording_cleanup_log
       WHERE job_run_id = $1
         AND cleanup_reason = 'orphan'`,
      [jobRunId],
    )) as { rows: Array<{ total: string }> };
    const orphanBytesThisRun = parseInt(rows[0]?.total ?? '0', 10);
    report.totalBytesReclaimed = report.hardDeletedBytes;
    const totalPendingBytes = orphanBytesThisRun;
    report.estimatedMonthlySavingsUsd = estimateMonthlyCostUsd(
      report.hardDeletedBytes + totalPendingBytes,
    );
  } catch (err) {
    // Non-fatal — use what we have
    report.totalBytesReclaimed = report.hardDeletedBytes;
    report.estimatedMonthlySavingsUsd = estimateMonthlyCostUsd(report.hardDeletedBytes);
  }

  logger.info('[RecordingCleanup] Job completed', {
    jobRunId,
    s3ObjectsScanned: report.s3ObjectsScanned,
    orphansFound: report.orphansFound,
    orphansMarkedForDeletion: report.orphansMarkedForDeletion,
    hardDeletedObjects: report.hardDeletedObjects,
    hardDeletedBytes: report.hardDeletedBytes,
    multipartUploadsAborted: report.multipartUploadsAborted,
    estimatedMonthlySavingsUsd: report.estimatedMonthlySavingsUsd,
    errors: errors.length,
  });

  return report;
}
