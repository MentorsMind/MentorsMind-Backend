/**
 * Stale Data Cleanup Job
 *
 * Scheduled job for automatic cleanup of stale data:
 * - Delete old notifications (>90 days)
 * - Delete expired refresh tokens
 * - Delete old audit logs (keep 7 years)
 * - Archive old sessions (>2 years)
 *
 * Runs daily at 3 AM UTC
 */

import staleDataCleanupManager from "../utils/stale-data-cleanup.utils";
import { logInfo, logWarning, logError } from "../utils/error.utils";

// Declare require for dynamic imports
declare const require: any;

class StaleDataCleanupJob {
  private job: any;

  /**
   * Initialize the cleanup job
   */
  initialize(): void {
    this.startDailyCleanupJob();
  }

  /**
   * Daily cleanup job
   * Runs every day at 3 AM UTC
   */
  private startDailyCleanupJob(): void {
    try {
      const { CronJob } = require("cron");
      this.job = new CronJob("0 3 * * *", async () => {
        await this.executeCleanup();
      });

      this.job.start();
      logInfo("Daily stale data cleanup job started (3 AM UTC)");
    } catch (error) {
      logWarning("Failed to start daily cleanup job", {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Execute cleanup operation
   */
  private async executeCleanup(): Promise<void> {
    try {
      logInfo("Executing scheduled stale data cleanup");

      const results = await staleDataCleanupManager.runFullCleanupCycle();

      const summary = {
        operationsCompleted: results.length,
        totalRecordsDeleted: results.reduce(
          (sum, r) => sum + r.recordsDeleted,
          0,
        ),
        totalRecordsArchived: results.reduce(
          (sum, r) => sum + r.recordsArchived,
          0,
        ),
        totalDuration: results.reduce((sum, r) => sum + r.duration, 0),
        operations: results.map((r) => ({
          type: r.operation,
          status: r.status,
          deleted: r.recordsDeleted,
          archived: r.recordsArchived,
        })),
      };

      logInfo("Scheduled cleanup completed", summary);
    } catch (error) {
      logError(error as Error, "high", {
        operation: "scheduled_cleanup",
      });
    }
  }

  /**
   * Stop the cleanup job
   */
  stop(): void {
    if (this.job) {
      this.job.stop();
      logInfo("Stale data cleanup job stopped");
    }
  }

  /**
   * Get job status
   */
  getStatus() {
    if (!this.job) {
      return {
        running: false,
        message: "Job not initialized",
      };
    }

    return {
      running: this.job.running,
      nextDate: this.job.nextDate().toISOString(),
    };
  }

  /**
   * Manually trigger cleanup
   */
  async triggerCleanup(): Promise<any> {
    return staleDataCleanupManager.runFullCleanupCycle();
  }

  /**
   * Manually trigger specific cleanup operation
   */
  async triggerNotificationCleanup(): Promise<any> {
    return staleDataCleanupManager.deleteOldNotifications();
  }

  async triggerTokenCleanup(): Promise<any> {
    return staleDataCleanupManager.deleteExpiredRefreshTokens();
  }

  async triggerAuditLogCleanup(): Promise<any> {
    return staleDataCleanupManager.deleteOldAuditLogs();
  }

  async triggerSessionArchival(): Promise<any> {
    return staleDataCleanupManager.archiveOldSessions();
  }
}

export default new StaleDataCleanupJob();
