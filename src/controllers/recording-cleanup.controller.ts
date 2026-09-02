/**
 * Recording Cleanup Controller
 *
 * Exposes admin endpoints for:
 *  - GET  /api/v1/admin/recordings/cleanup-report  — latest cleanup stats
 *  - POST /api/v1/admin/recordings/cleanup-run     — trigger an immediate run
 *  - POST /api/v1/admin/recordings/cleanup-recover — recover a pending-deletion object
 */

import { Response } from 'express';
import { AuthenticatedRequest } from '../types/api.types';
import { ResponseUtil } from '../utils/response.utils';
import { db } from '../config/database';
import { recordingCleanupQueue } from '../queues/recordingCleanup.queue';
import { logger } from '../utils/logger.utils';

interface CleanupReportRow {
  job_run_id: string;
  detected_at: Date;
  orphans_found: string;
  pending_deletion: string;
  deleted: string;
  recovered: string;
  multipart_aborted: string;
  total_bytes_pending: string;
  total_bytes_deleted: string;
}

/** S3 Standard $/GB/month — kept consistent with the job */
const S3_COST_PER_GB_PER_MONTH_USD = 0.023;

function estimateMonthlyCostUsd(bytes: number): number {
  const gb = bytes / (1024 * 1024 * 1024);
  return parseFloat((gb * S3_COST_PER_GB_PER_MONTH_USD).toFixed(4));
}

export const RecordingCleanupController = {
  /**
   * GET /admin/recordings/cleanup-report
   *
   * Returns aggregated stats for the most recent cleanup job run.
   * Falls back to the last 5 runs if the caller passes ?limit=5.
   */
  async getCleanupReport(req: AuthenticatedRequest, res: Response): Promise<void> {
    const limitParam = req.query.limit;
    const limitValue = Array.isArray(limitParam) ? limitParam[0] : limitParam;
    const limit = Math.min(parseInt(limitValue as string) || 1, 20);

    // Aggregate stats per job_run_id, ordered by most recent first
    const { rows } = await db.query<CleanupReportRow>(
      `SELECT
          job_run_id,
          MIN(detected_at)                                          AS detected_at,
          COUNT(*) FILTER (WHERE cleanup_reason = 'orphan')        AS orphans_found,
          COUNT(*) FILTER (
            WHERE cleanup_reason = 'orphan'
              AND deletion_status = 'pending_deletion'
          )                                                         AS pending_deletion,
          COUNT(*) FILTER (
            WHERE cleanup_reason = 'orphan'
              AND deletion_status = 'deleted'
          )                                                         AS deleted,
          COUNT(*) FILTER (WHERE deletion_status = 'recovered')    AS recovered,
          COUNT(*) FILTER (
            WHERE cleanup_reason = 'incomplete_multipart'
              AND deletion_status = 'deleted'
          )                                                         AS multipart_aborted,
          COALESCE(SUM(file_size_bytes) FILTER (
            WHERE cleanup_reason = 'orphan'
              AND deletion_status = 'pending_deletion'
          ), 0)                                                     AS total_bytes_pending,
          COALESCE(SUM(file_size_bytes) FILTER (
            WHERE cleanup_reason = 'orphan'
              AND deletion_status = 'deleted'
          ), 0)                                                     AS total_bytes_deleted
       FROM recording_cleanup_log
       GROUP BY job_run_id
       ORDER BY MIN(detected_at) DESC
       LIMIT $1`,
      [limit],
    );

    if (rows.length === 0) {
      ResponseUtil.success(
        res,
        { runs: [], message: 'No cleanup runs found yet' },
        'Cleanup report retrieved successfully',
      );
      return;
    }

    const runs = rows.map((row) => {
      const bytesPending = parseInt(row.total_bytes_pending, 10) || 0;
      const bytesDeleted = parseInt(row.total_bytes_deleted, 10) || 0;
      const totalBytesReclaimed = bytesDeleted;
      const totalBytesPendingReclaim = bytesPending;

      return {
        jobRunId: row.job_run_id,
        ranAt: row.detected_at,
        orphansFound: parseInt(row.orphans_found, 10) || 0,
        pendingDeletion: parseInt(row.pending_deletion, 10) || 0,
        hardDeleted: parseInt(row.deleted, 10) || 0,
        recovered: parseInt(row.recovered, 10) || 0,
        multipartUploadsAborted: parseInt(row.multipart_aborted, 10) || 0,
        bytesReclaimed: totalBytesReclaimed,
        bytesPendingReclaim: totalBytesPendingReclaim,
        estimatedMonthlySavingsUsd: estimateMonthlyCostUsd(
          totalBytesReclaimed + totalBytesPendingReclaim,
        ),
      };
    });

    ResponseUtil.success(
      res,
      limit === 1 ? runs[0] : { runs },
      'Cleanup report retrieved successfully',
    );
  },

  /**
   * POST /admin/recordings/cleanup-run
   *
   * Enqueues an immediate (high-priority) cleanup job rather than waiting
   * for the Saturday cron.
   */
  async triggerCleanupRun(_req: AuthenticatedRequest, res: Response): Promise<void> {
    const job = await recordingCleanupQueue.add(
      'recording-cleanup-manual',
      { jobType: 'recording-cleanup' },
      { priority: 1 }, // High priority — runs ahead of scheduled jobs
    );

    logger.info('[RecordingCleanupController] Manual cleanup triggered', { jobId: job.id });

    ResponseUtil.success(
      res,
      { jobId: job.id, status: 'queued' },
      'Recording cleanup job queued successfully',
      202,
    );
  },

  /**
   * POST /admin/recordings/cleanup-recover
   *
   * Marks a pending-deletion log entry as recovered, preventing hard deletion.
   * Body: { logId: string }
   */
  async recoverPendingDeletion(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { logId } = req.body as { logId?: string };

    if (!logId || typeof logId !== 'string') {
      ResponseUtil.error(res, 'logId is required', 400);
      return;
    }

    const { rows } = await db.query<{ id: string; deletion_status: string; s3_key: string }>(
      `UPDATE recording_cleanup_log
       SET deletion_status = 'recovered', recovered_at = NOW()
       WHERE id = $1
         AND deletion_status = 'pending_deletion'
       RETURNING id, deletion_status, s3_key`,
      [logId],
    );

    if (rows.length === 0) {
      ResponseUtil.notFound(
        res,
        'Cleanup log entry not found or not in pending_deletion state',
      );
      return;
    }

    logger.info('[RecordingCleanupController] Object recovered from pending deletion', {
      logId,
      s3Key: rows[0].s3_key,
      recoveredBy: req.user?.id,
    });

    ResponseUtil.success(
      res,
      { logId: rows[0].id, s3Key: rows[0].s3_key, status: 'recovered' },
      'Object recovered — it will no longer be deleted',
    );
  },
};
