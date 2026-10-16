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
import { emailService } from "../services/email.service";
import { env } from "../config/env";
import {
  backupDurationSeconds,
  backupOperationsTotal,
  backupSizeBytes,
} from "../config/metrics";

export type BackupMetricType = "full" | "wal" | "retention";

/**
 * Records Prometheus metrics for a backup operation (issue #1303).
 * Exported for unit testing. `GET /metrics` exposes these automatically via
 * `metricsRegistry` — no route changes needed.
 */
export function recordBackupOperation(
  type: BackupMetricType,
  durationSeconds: number,
  status: "success" | "failure",
  sizeBytes?: number,
): void {
  backupDurationSeconds.observe({ type }, durationSeconds);
  backupOperationsTotal.inc({ type, status });
  if (typeof sizeBytes === "number" && status === "success") {
    backupSizeBytes.set({ type }, sizeBytes);
  }
}

/**
 * Fire-and-forget admin alert email for backup/integrity failures.
 * logError() already forwards to Sentry (src/utils/error.utils.ts), so this
 * only needs to add the email leg of the alert per issue #690.
 */
function alertAdmins(subject: string, message: string): void {
  const to = env.ADMIN_ALERT_EMAIL;
  if (!to) return;
  emailService
    .sendEmail({
      to: [to],
      subject: `[MentorsMind] ${subject}`,
      htmlContent: `<p>${message}</p>`,
      textContent: message,
    })
    .catch((err) => logWarning("Failed to send backup alert email", { err }));
}

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
        const start = Date.now();
        const result = await BackupService.runFullBackup();
        recordBackupOperation(
          "full",
          (Date.now() - start) / 1000,
          result.status === "completed" ? "success" : "failure",
          result.size,
        );
        if (result.status === "completed") {
          logInfo("Daily full backup completed", {
            jobId: result.id,
            size: result.size,
            duration: result.duration,
          });
          const verification = await BackupService.verifyBackup(result.id);
          if (!verification.valid) {
            const err = new Error(
              `Backup integrity check failed: ${verification.error ?? "unknown"}`,
            );
            logError(err, "critical", { jobId: result.id });
            alertAdmins(
              "Backup integrity check failed",
              `Integrity verification failed for backup ${result.id}: ${verification.error ?? "unknown"}`,
            );
          }
        } else {
          const err = new Error(
            `Daily full backup failed: ${result.error ?? "unknown"}`,
          );
          logError(err, "high", { jobId: result.id });
          alertAdmins(
            "Daily backup failed",
            `Daily full backup job ${result.id} failed: ${result.error ?? "unknown"}`,
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
        const start = Date.now();
        const result = await BackupService.runWALBackup();
        recordBackupOperation(
          "wal",
          (Date.now() - start) / 1000,
          result.status === "completed" ? "success" : "failure",
          result.size,
        );
        if (result.status === "failed") {
          const err = new Error(
            `WAL backup failed: ${result.error ?? "unknown"}`,
          );
          logError(err, "high", { jobId: result.id });
          alertAdmins(
            "WAL backup failed",
            `WAL backup job ${result.id} failed: ${result.error ?? "unknown"}`,
          );
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
        const start = Date.now();
        try {
          const { removed } = await BackupService.applyRetentionPolicy();
          recordBackupOperation(
            "retention",
            (Date.now() - start) / 1000,
            "success",
          );
          logInfo("Backup retention cleanup completed", { removed });
        } catch (error) {
          recordBackupOperation(
            "retention",
            (Date.now() - start) / 1000,
            "failure",
          );
          throw error;
        }
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
