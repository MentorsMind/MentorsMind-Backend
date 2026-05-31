/**
 * Backup Job
 *
 * Cron-scheduled jobs for automated database backups:
 * - Daily full backup at 2 AM UTC
 * - Hourly WAL archiving
 * - Daily retention policy enforcement
 */

import { BackupService } from "../services/backup.service";
import { logInfo, logWarning, logError } from "../utils/error.utils";

declare const require: any;

class BackupJob {
  private jobs: Map<string, any> = new Map();

  initialize(): void {
    this.startDailyFullBackup();
    this.startHourlyWALBackup();
    this.startDailyRetentionCleanup();

    logInfo("Backup jobs initialized", { jobCount: this.jobs.size });
  }

  /** Daily full backup — every day at 2 AM UTC */
  private startDailyFullBackup(): void {
    try {
      const { CronJob } = require("cron");
      const job = new CronJob("0 2 * * *", async () => {
        logInfo("Running scheduled daily full backup");
        const result = await BackupService.runFullBackup();
        if (result.status === "completed") {
          logInfo("Daily full backup completed", {
            jobId: result.id,
            size: result.size,
            duration: result.duration,
          });
          await BackupService.verifyBackup(result.id);
        } else {
          logError(
            "Daily full backup failed",
            new Error(result.error ?? "unknown"),
            {
              jobId: result.id,
            },
          );
        }
      });

      job.start();
      this.jobs.set("daily-full-backup", job);
      logInfo("Daily full backup job started (2 AM UTC)");
    } catch (error) {
      logWarning("Failed to start daily full backup job", {
        error: (error as Error).message,
      });
    }
  }

  /** Hourly WAL archiving */
  private startHourlyWALBackup(): void {
    try {
      const { CronJob } = require("cron");
      const job = new CronJob("0 * * * *", async () => {
        logInfo("Running scheduled WAL backup");
        const result = await BackupService.runWALBackup();
        if (result.status === "failed") {
          logError("WAL backup failed", new Error(result.error ?? "unknown"), {
            jobId: result.id,
          });
        }
      });

      job.start();
      this.jobs.set("hourly-wal-backup", job);
      logInfo("Hourly WAL backup job started");
    } catch (error) {
      logWarning("Failed to start hourly WAL backup job", {
        error: (error as Error).message,
      });
    }
  }

  /** Daily retention cleanup — every day at 3 AM UTC */
  private startDailyRetentionCleanup(): void {
    try {
      const { CronJob } = require("cron");
      const job = new CronJob("0 3 * * *", async () => {
        logInfo("Running backup retention cleanup");
        const { removed } = await BackupService.applyRetentionPolicy();
        logInfo("Backup retention cleanup completed", { removed });
      });

      job.start();
      this.jobs.set("daily-retention-cleanup", job);
      logInfo("Daily retention cleanup job started (3 AM UTC)");
    } catch (error) {
      logWarning("Failed to start daily retention cleanup job", {
        error: (error as Error).message,
      });
    }
  }

  getStatus(): Record<string, { running: boolean }> {
    const status: Record<string, { running: boolean }> = {};
    for (const [name, job] of this.jobs.entries()) {
      status[name] = { running: job.running ?? false };
    }
    return status;
  }

  stop(): void {
    for (const [name, job] of this.jobs.entries()) {
      job.stop?.();
      logInfo(`Stopped backup job: ${name}`);
    }
    this.jobs.clear();
  }
}

const backupJob = new BackupJob();
export default backupJob;
