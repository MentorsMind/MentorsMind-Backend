import { reportQueue } from "../queues/report.queue";
import { sessionReminderQueue } from "../queues/sessionReminder.queue";
import { escrowCheckQueue } from "../queues/escrow-check.queue";
import { notificationCleanupQueue } from "../queues/notificationCleanup.queue";
import { accountDeletionQueue } from "../queues/accountDeletion.queue";
import { analyticsRefreshQueue } from "../queues/analyticsRefresh.queue";
import { VerificationService } from "../services/verification.service";
import { logger } from "../utils/logger.utils";

/**
 * Register repeatable jobs.
 * BullMQ v5+ handles delayed/repeatable jobs natively — no QueueScheduler needed.
 * Call once at server startup.
 */
export async function startScheduler(): Promise<void> {
  // Weekly earnings report — every Monday at 08:00 UTC
  await reportQueue.add(
    "weekly-earnings-scheduled",
    {
      reportType: "weekly-earnings",
      periodStart: "", // worker computes dynamically from current date
      periodEnd: "",
    },
    {
      repeat: { pattern: "0 8 * * 1" }, // cron: Monday 08:00 UTC
      jobId: "weekly-earnings-recurring",
    },
  );

  // Session reminders — every 5 minutes
  await sessionReminderQueue.add(
    "session-reminder-scheduled",
    { jobType: "session-reminder" },
    {
      repeat: { pattern: "*/5 * * * *" },
      jobId: "session-reminder-recurring",
    },
  );

  // Hourly escrow eligibility check — releases escrows past the 48h window
  await escrowCheckQueue.add(
    "escrow-check-scheduled",
    { jobType: "escrow-check-cron", triggeredAt: new Date().toISOString() },
    {
      repeat: { pattern: "0 * * * *" }, // cron: every hour on the hour
      jobId: "escrow-check-recurring",
    },
  );

  // Notification cleanup — daily at 02:00 UTC (delete expired notifications)
  await notificationCleanupQueue.add(
    "notification-cleanup-scheduled",
    { jobType: "notification-cleanup" },
    {
      repeat: { pattern: "0 2 * * *" },
      jobId: "notification-cleanup-recurring",
    },
  );

  // Account deletion — daily at 03:00 UTC (GDPR Article 17: erase users past 30-day grace period)
  await accountDeletionQueue.add(
    "process-deletions",
    { jobType: "account-deletion" },
    {
      repeat: { pattern: "0 3 * * *" },
      jobId: "account-deletion-recurring",
    },
  );

  // Analytics refresh — every hour (BullMQ distributed lock prevents duplicate runs across instances)
  await analyticsRefreshQueue.add(
    "refresh-analytics",
    { jobType: "analytics-refresh" },
    {
      repeat: { pattern: "0 * * * *" },
      jobId: "analytics-refresh-recurring",
    },
  );

  logger.info(
    "Job scheduler started — weekly earnings, session reminders, escrow check, notification cleanup, account deletion, and analytics refresh registered",
  );
}

export async function stopScheduler(): Promise<void> {
  logger.info("Job scheduler stopped");
}

/**
 * Run periodic maintenance tasks (called externally or via a daily cron).
 */
export async function runMaintenanceTasks(): Promise<void> {
  const expired = await VerificationService.flagExpiredVerifications();
  if (expired > 0) {
    logger.info("Maintenance: expired verifications flagged", {
      count: expired,
    });
  }
}
