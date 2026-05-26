import { Request, Response } from "express";
import { DataExportService } from "../services/dataExport.service";
import { logger } from "../utils/logger.utils";

export const DataExportController = {
  async requestExport(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.id;
      const request = await DataExportService.requestExport(userId);

      res.status(202).json({
        message:
          "Data export request accepted. You will receive an email once it is ready.",
        requestId: request.id,
        status: request.status,
      });
    } catch (error: any) {
      logger.error("Failed to request data export", {
        error: error.message,
        userId: req.user?.id,
      });
      res.status(error.message.includes("30 days") ? 429 : 500).json({
        error: error.message || "Failed to request data export",
      });
    }
  },

  async getExportStatus(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.id;
      const latestRequest = await DataExportService.getExportStatus(userId);

      if (!latestRequest) {
        res
          .status(404)
          .json({ error: "No export requests found for this user." });
        return;
      }

      res.status(200).json({
        requestId: latestRequest.id,
        status: latestRequest.status,
        requestedAt: latestRequest.requested_at,
        processedAt: latestRequest.processed_at,
        expiresAt: latestRequest.expires_at,
      });
    } catch (error: any) {
      logger.error("Failed to get data export status", {
        error: error.message,
        userId: req.user?.id,
      });
      res.status(500).json({ error: "Failed to get data export status" });
    }
  },
};
