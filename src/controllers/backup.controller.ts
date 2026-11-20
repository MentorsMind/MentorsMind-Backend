import { Request, Response } from "express";
import { BackupService } from "../services/backup.service";
import { asyncHandler } from "../utils/asyncHandler.utils";

export const BackupController = {
  /** GET /admin/backups — durable backup history (backup_log table) */
  listBackups: asyncHandler(async (req: Request, res: Response) => {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const result = await BackupService.listBackups(limit, offset);
    res.json({
      success: true,
      data: result.data,
      total: result.total,
      limit,
      offset,
    });
  }),

  /** POST /admin/backups/restore */
  restoreToPoint: asyncHandler(async (req: Request, res: Response) => {
    const { targetTime } = req.body;
    if (!targetTime) {
      res
        .status(400)
        .json({ success: false, message: "targetTime is required (ISO 8601)" });
      return;
    }
    const target = new Date(targetTime);
    if (isNaN(target.getTime())) {
      res
        .status(400)
        .json({ success: false, message: "Invalid targetTime format" });
      return;
    }
    const result = await BackupService.restoreToPoint(target);
    res.json({ success: true, data: result });
  }),

  /** POST /admin/backup/full */
  triggerFullBackup: asyncHandler(async (_req: Request, res: Response) => {
    const job = await BackupService.runFullBackup();
    res.status(202).json({ success: true, data: job });
  }),

  /** POST /admin/backup/wal */
  triggerWALBackup: asyncHandler(async (_req: Request, res: Response) => {
    const job = await BackupService.runWALBackup();
    res.status(202).json({ success: true, data: job });
  }),

  /** GET /admin/backup/jobs */
  listJobs: asyncHandler(async (_req: Request, res: Response) => {
    const jobs = await BackupService.listJobs();
    res.json({ success: true, data: jobs, count: jobs.length });
  }),

  /** GET /admin/backup/jobs/:id */
  getJob: asyncHandler(async (req: Request, res: Response) => {
    const job = await BackupService.getJob(req.params.id as string);
    if (!job) {
      res.status(404).json({ success: false, message: "Backup job not found" });
      return;
    }
    res.json({ success: true, data: job });
  }),

  /** POST /admin/backup/jobs/:id/verify */
  verifyBackup: asyncHandler(async (req: Request, res: Response) => {
    const result = await BackupService.verifyBackup(req.params.id as string);
    res.json({ success: true, data: result });
  }),

  /** POST /admin/backup/retention */
  applyRetention: asyncHandler(async (_req: Request, res: Response) => {
    const result = await BackupService.applyRetentionPolicy();
    res.json({ success: true, data: result });
  }),

  /** GET /admin/backup/pitr */
  getPITRCandidate: asyncHandler(async (req: Request, res: Response) => {
    const { targetTime } = req.query;
    if (!targetTime || typeof targetTime !== "string") {
      res
        .status(400)
        .json({
          success: false,
          message: "targetTime query param required (ISO 8601)",
        });
      return;
    }

    const target = new Date(targetTime);
    if (isNaN(target.getTime())) {
      res
        .status(400)
        .json({ success: false, message: "Invalid targetTime format" });
      return;
    }

    const candidate = await BackupService.getPITRCandidate(target);
    if (!candidate) {
      res
        .status(404)
        .json({
          success: false,
          message: "No suitable backup found for the given target time",
        });
      return;
    }

    res.json({ success: true, data: candidate });
  }),
};
