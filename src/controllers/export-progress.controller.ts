/**
 * Export Progress Controller
 *
 * GET  /api/v1/exports/:jobId/progress
 *   Returns live BullMQ job progress (0–100 %) plus DB status,
 *   format, and size. Never re-executes the export.
 *
 * POST /api/v1/exports
 *   Request a new export (format: json | csv | pdf).
 *
 * POST /api/v1/admin/exports/:jobId/approve
 *   Admin approves a large (>1 GB) pending export and re-enqueues it.
 *
 * POST /api/v1/admin/exports/:jobId/reject
 *   Admin rejects a large export request.
 *
 * GET  /api/v1/admin/exports/pending-approvals
 *   List exports awaiting admin approval.
 */

import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import { ResponseUtil } from "../utils/response.utils";
import { ExportJobModel, ExportFormat } from "../models/export-job.model";
import { ExportService } from "../services/export.service";
import { exportQueue } from "../queues/export.queue";
import { logger } from "../utils/logger.utils";

const VALID_FORMATS: ExportFormat[] = ["json", "csv", "pdf"];

// ---------------------------------------------------------------------------
// User-facing endpoints
// ---------------------------------------------------------------------------

export const ExportProgressController = {
  /**
   * POST /exports
   * Request a new full-data export in the specified format.
   */
  async requestExport(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user!.id;
    const format: ExportFormat = VALID_FORMATS.includes(req.body.format)
      ? req.body.format
      : "json";

    const jobId = await ExportService.requestExport(userId, format);

    ResponseUtil.success(
      res,
      { jobId, format, status: "pending" },
      `Export requested. Format: ${format}. You will be notified via Socket.IO and email when ready.`,
      202,
    );
  },

  /**
   * GET /exports/:jobId/progress
   *
   * Reads BullMQ job progress (live %) and DB metadata.
   * Returns without re-executing anything.
   */
  async getProgress(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId  = req.user!.id;
    const { jobId } = req.params as { jobId: string };

    // 1. Verify ownership via DB record
    const dbJob = await ExportJobModel.findById(jobId);
    if (!dbJob || dbJob.user_id !== userId) {
      ResponseUtil.notFound(res, "Export job not found");
      return;
    }

    let bullmqProgress: number | null = null;
    let bullmqState: string | null = null;
    let bullmqFailReason: string | null = null;

    // 2. If we have a BullMQ job ID, fetch live progress
    if (dbJob.bullmq_job_id) {
      try {
        const bJob = await exportQueue.getJob(dbJob.bullmq_job_id);
        if (bJob) {
          bullmqProgress  = typeof bJob.progress === "number" ? bJob.progress : null;
          bullmqState     = await bJob.getState();
          bullmqFailReason = bJob.failedReason ?? null;
        }
      } catch (err) {
        // Non-fatal — job may have been cleaned up from BullMQ already
        logger.warn("[ExportProgressController] Could not fetch BullMQ job", {
          bullmqJobId: dbJob.bullmq_job_id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 3. Derive a unified percent from BullMQ progress or DB status
    const percent = derivePercent(bullmqProgress, dbJob.status);

    ResponseUtil.success(res, {
      jobId,
      status: dbJob.status,
      format: dbJob.format,
      percent,
      bullmqState,
      approvalStatus: dbJob.approval_status,
      estimatedSizeBytes: dbJob.estimated_size_bytes,
      actualSizeBytes: dbJob.actual_size_bytes,
      createdAt: dbJob.created_at,
      expiresAt: dbJob.expires_at,
      errorMessage: dbJob.error_message ?? bullmqFailReason ?? null,
    }, "Export progress retrieved");
  },
};

// ---------------------------------------------------------------------------
// Admin endpoints
// ---------------------------------------------------------------------------

export const ExportAdminController = {
  /**
   * GET /admin/exports/pending-approvals
   */
  async listPendingApprovals(_req: AuthenticatedRequest, res: Response): Promise<void> {
    const jobs = await ExportJobModel.findPendingApprovals();
    ResponseUtil.success(res, { jobs, total: jobs.length }, "Pending approvals retrieved");
  },

  /**
   * POST /admin/exports/:jobId/approve
   * Approves a large export and re-enqueues it.
   */
  async approveExport(req: AuthenticatedRequest, res: Response): Promise<void> {
    const adminId = req.user!.id;
    const { jobId } = req.params as { jobId: string };

    const dbJob = await ExportJobModel.findById(jobId);
    if (!dbJob) {
      ResponseUtil.notFound(res, "Export job not found");
      return;
    }
    if (dbJob.approval_status !== "pending") {
      ResponseUtil.error(res, "Export is not awaiting approval", 400);
      return;
    }

    await ExportJobModel.updateApprovalStatus(jobId, "approved", adminId);
    await ExportJobModel.updateStatus(jobId, "pending");

    // Re-enqueue the job now that approval is granted
    const bullJob = await exportQueue.add("process-export", {
      userId: dbJob.user_id,
      jobId,
      format: dbJob.format,
      type: "data-export",
    }, { priority: 5 });

    await ExportJobModel.setBullmqJobId(jobId, bullJob.id!);

    logger.info("[ExportAdminController] Large export approved and re-queued", {
      jobId, adminId, bullmqJobId: bullJob.id,
    });

    ResponseUtil.success(
      res,
      { jobId, bullmqJobId: bullJob.id, status: "pending" },
      "Export approved and queued for processing",
    );
  },

  /**
   * POST /admin/exports/:jobId/reject
   */
  async rejectExport(req: AuthenticatedRequest, res: Response): Promise<void> {
    const adminId = req.user!.id;
    const { jobId } = req.params as { jobId: string };
    const reason: string = req.body.reason || "Rejected by admin";

    const dbJob = await ExportJobModel.findById(jobId);
    if (!dbJob) {
      ResponseUtil.notFound(res, "Export job not found");
      return;
    }
    if (dbJob.approval_status !== "pending") {
      ResponseUtil.error(res, "Export is not awaiting approval", 400);
      return;
    }

    await ExportJobModel.updateApprovalStatus(jobId, "rejected", adminId);
    await ExportJobModel.updateStatus(jobId, "failed", undefined, reason);

    // Notify the user over Socket.IO
    const { SocketService } = await import("../services/socket.service");
    SocketService.emitToUser(dbJob.user_id, "export:progress", {
      step: "rejected",
      percent: 0,
      jobId,
      error: reason,
    });

    ResponseUtil.success(res, { jobId, status: "failed" }, "Export rejected");
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function derivePercent(
  bullmqProgress: number | null,
  dbStatus: string,
): number {
  // If BullMQ has live data, use it
  if (bullmqProgress !== null && bullmqProgress >= 0) return bullmqProgress;
  // Fall back to DB status sentinel values
  switch (dbStatus) {
    case "pending":    return 0;
    case "processing": return 5;  // we know it started, but can't be more specific
    case "completed":  return 100;
    case "failed":     return -1;
    default:           return 0;
  }
}
