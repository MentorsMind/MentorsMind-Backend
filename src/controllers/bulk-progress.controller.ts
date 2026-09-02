import { Request, Response, NextFunction } from "express";
import { redis } from "../config/redis";
import { BulkService } from "../services/bulk.service";
import { bulkQueue } from "../queues/bulk.queue";
import { createError } from "../middleware/errorHandler";
import { BulkJobModel } from "../models/bulk-job.model";

export const BulkProgressController = {
  async getStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { jobId } = req.params;
      const requestedBy = req.user?.id || req.user?.userId;

      if (!requestedBy) {
        throw createError("Unauthorized", 401);
      }

      const userId = Array.isArray(requestedBy) ? requestedBy[0] : requestedBy;

      const job = await BulkService.getJob(jobId, userId);
      if (!job) {
        throw createError("Job not found", 404);
      }

      // Fetch progress from Redis
      const redisProgress = await redis.get(`bulk:${jobId}:progress`);
      let progressState = null;
      if (redisProgress) {
        try {
          progressState = JSON.parse(redisProgress);
        } catch (e) {
          // fallback if it was a plain integer
          progressState = { progress: parseInt(redisProgress, 10) };
        }
      }

      const progress = progressState?.progress ?? (job.status === "completed" ? 100 : 0);

      res.status(200).json({
        success: true,
        data: {
          jobId: job.id,
          status: job.status,
          jobType: job.job_type,
          totalRecords: job.total_records,
          successCount: job.success_count,
          failureCount: job.failure_count,
          progress,
          progressDetails: progressState,
          createdAt: job.created_at,
          updatedAt: job.updated_at,
        },
      });
    } catch (error) {
      next(error);
    }
  },

  async deleteJob(req: Request, res: Response, next: NextFunction) {
    try {
      const { jobId } = req.params;
      const requestedBy = req.user?.id || req.user?.userId;

      if (!requestedBy) {
        throw createError("Unauthorized", 401);
      }

      const userId = Array.isArray(requestedBy) ? requestedBy[0] : requestedBy;

      const job = await BulkService.getJob(jobId, userId);
      if (!job) {
        throw createError("Job not found", 404);
      }

      // Remove from BullMQ if it's there
      try {
        const bullJob = await bulkQueue.getJob(jobId);
        if (bullJob) {
          await bullJob.remove();
        }
      } catch (err) {
        // Ignored if job doesn't exist in queue
      }

      // We can also mark it as cancelled or deleted in DB
      await BulkJobModel.updateStatus(jobId, "failed", { errorMessage: "Cancelled by user" });
      await redis.del(`bulk:${jobId}:progress`);

      res.status(200).json({
        success: true,
        message: "Bulk job cancelled and removed from queue.",
      });
    } catch (error) {
      next(error);
    }
  },
};
