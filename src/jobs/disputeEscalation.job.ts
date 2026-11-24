/**
 * Dispute Escalation Job
 *
 * Automatically escalates open disputes that are older than 7 days to `investigating`.
 * Can be run:
 *  - Via CronJob: scheduled daily at midnight UTC
 *  - Via BullMQ: scheduled in maintenanceQueue by scheduler.ts and processed by maintenanceWorker
 *  - Programmatically via runDisputeEscalationJob()
 */

import { CronJob } from "cron";
import { DisputeService } from "../services/disputes.service";
import { logger } from "../utils/logger.utils";

export interface DisputeEscalationResult {
  escalatedCount: number;
}

/**
 * Main entry point — called by the scheduler, BullMQ worker, or cron runner.
 */
export async function runDisputeEscalationJob(): Promise<DisputeEscalationResult> {
  try {
    logger.info("[DisputeEscalation] Starting dispute auto-escalation job");
    const escalatedCount = await DisputeService.escalateOldDisputes();
    logger.info("[DisputeEscalation] Dispute auto-escalation job completed", {
      escalatedCount,
    });
    return { escalatedCount };
  } catch (error) {
    logger.error("[DisputeEscalation] Dispute auto-escalation job failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export class DisputeEscalationJob {
  private job: CronJob | null = null;

  initialize(): void {
    if (this.job) {
      logger.warn("Dispute escalation job already initialized");
      return;
    }

    try {
      this.job = new CronJob(
        "0 0 * * *",
        async () => {
          logger.info("Running scheduled dispute auto-escalation check");
          try {
            await runDisputeEscalationJob();
          } catch (error) {
            logger.error("Scheduled dispute auto-escalation run failed", {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        },
        null,
        false,
        "UTC",
      );

      this.job.start();
      logger.info("Dispute escalation job started (daily at 00:00 UTC)");
    } catch (error) {
      logger.warn("Failed to start dispute escalation job", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  stop(): void {
    this.job?.stop();
    this.job = null;
    logger.info("Dispute escalation job stopped");
  }
}

export const disputeEscalationJob = new DisputeEscalationJob();
export default disputeEscalationJob;
