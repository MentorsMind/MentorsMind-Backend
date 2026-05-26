import { Job } from "bullmq";
import { DataExportService } from "../services/dataExport.service";
import { logger } from "../utils/logger.utils";

export const runDataExportJob = async (job: Job): Promise<void> => {
  const { userId, requestId } = job.data;

  logger.info("Starting data export job", { userId, requestId });

  try {
    await DataExportService.processExport(userId, requestId);
    logger.info("Data export job completed successfully", {
      userId,
      requestId,
    });
  } catch (error: any) {
    logger.error("Data export job failed", {
      userId,
      requestId,
      error: error.message,
    });
    throw error;
  }
};
