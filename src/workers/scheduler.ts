import { reportQueue } from "../queues/report.queue";
import { sessionReminderQueue } from "../queues/sessionReminder.queue";
import { escrowCheckQueue } from "../queues/escrow-check.queue";
import { notificationCleanupQueue } from "../queues/notificationCleanup.queue";
import { maintenanceQueue } from "../queues/maintenance.queue";
import { VerificationService } from "../services/verification.service";
import { accountDeletionJob } from "../jobs/accountDeletion.job";
import { logger } from "../utils/logger.utils";
import { Queue, JobsOptions } from "bullmq";

/**
 * Add a repeatable job only if it doesn't already exist.
 * Prevents duplicate repeatable jobs on server restarts.
 */
async function addRepeatableJobIfNotExists(
  queue: Queue,
  jobName: string,
  data: any,
  options: JobsOptions,
): Promise<void> {
  const existingJobs = await queue.getRepeatableJobs();
  const jobId = options.jobId;
  
  // Check if job already exists by jobId
  const exists = existingJobs.find(job => job.id === jobId);
  
  if (!exists) {
    await queue.add(jobName, data, options);
    logger.info(`Added repeatable job: ${jobName} (${jobId})`);
  } else {
    logger.info(`Repeatable job already exists: ${jobName} (${jobId})`);
  }
}

/**
 * Log the count of repeatable jobs for each queue
 */
async function logRepeatableJobCounts(): Promise<void> {
  const queues = [
    { name: "report", queue: reportQueue },
    { name: "sessionReminder", queue: sessionReminderQueue },
    { name: "escrowCheck", queue: escrowCheckQueue },
    { name: "notificationCleanup", queue: notificationCleanupQueue },
  ];

  for (const { name, queue } of queues) {
    const repeatableJobs = await queue.getRepeatableJobs();
    logger.info(`Queue ${name}: ${repeatableJobs.length} repeatable jobs`);
  }
}

/**
 * Register repeatable jobs.
 * BullMQ v5+ handles delayed/repeatable jobs natively — no QueueScheduler needed.
 * Call once at server startup.
 */
export async function startScheduler(): Promise<void> {
  // Weekly earnings report — every Monday at 08:00 UTC
  await addRepeatableJobIfNotExists(
    reportQueue,
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
  await addRepeatableJobIfNotExists(
    sessionReminderQueue,
    "session-reminder-scheduled",
    { jobType: "session-reminder" },
    {
      repeat: { pattern: "*/5 * * * *" },
      jobId: "session-reminder-recurring",
    },
  );

  // Hourly escrow eligibility check — releases escrows past the 48h window
  await addRepeatableJobIfNotExists(
    escrowCheckQueue,
    "escrow-check-scheduled",
    { jobType: "escrow-check-cron", triggeredAt: new Date().toISOString() },
    {
      repeat: { pattern: "0 * * * *" }, // cron: every hour on the hour
      jobId: "escrow-check-recurring",
    },
  );

  // Notification cleanup — daily at 02:00 UTC (delete expired notifications)
  await addRepeatableJobIfNotExists(
    notificationCleanupQueue,
    "notification-cleanup-scheduled",
    { jobType: "notification-cleanup" },
    {
      repeat: { pattern: "0 2 * * *" },
      jobId: "notification-cleanup-recurring",
    },
  );

  // Daily maintenance job — 04:00 UTC
  await maintenanceQueue.add(
    "daily-maintenance",
    {},
    {
      repeat: { pattern: "0 4 * * *" },
      jobId: "daily-maintenance-recurring",
    },
  );

  logger.info(
    "Job scheduler started — weekly earnings, session reminders, escrow check, notification cleanup, and daily maintenance registered",
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

  try {
    const deletions = await accountDeletionJob.run();
    if (deletions.processed > 0) {
      logger.info("Maintenance: processed account deletions", {
        total: deletions.processed,
        successful: deletions.successful,
        failed: deletions.failed,
      });
    }
  } catch (error) {
    logger.error("Maintenance: error processing account deletions", { error });
  }
}
