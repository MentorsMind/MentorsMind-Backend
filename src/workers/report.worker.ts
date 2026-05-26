import { Worker, Job } from "bullmq";
import pool from "../config/database";
import {
  redisConnection,
  CONCURRENCY,
  QUEUE_NAMES,
} from "../queues/queue.config";
import { logger } from "../utils/logger.utils";
import type { ReportJobData } from "../queues/report.queue";

async function generateWeeklyEarningsReport(
  job: Job<ReportJobData>,
): Promise<void> {
  const { periodStart, periodEnd, mentorId } = job.data;

  logger.info("Generating weekly earnings report", {
    jobId: job.id,
    periodStart,
    periodEnd,
    mentorId,
  });

  const params: any[] = [periodStart, periodEnd];
  let mentorFilter = "";

  if (mentorId) {
    params.push(mentorId);
    mentorFilter = `AND b.mentor_id = $${params.length}`;
  }

  const { rows } = await pool.query(
    `SELECT
       b.mentor_id,
       COUNT(b.id)::int          AS total_sessions,
       COALESCE(SUM(t.amount), 0) AS gross_earnings,
       COALESCE(SUM(t.amount * 0.95), 0) AS net_earnings
     FROM transactions t
     JOIN bookings b ON t.id = b.payment_transaction_id
     WHERE t.created_at BETWEEN $1 AND $2
       AND t.status = 'completed'
       ${mentorFilter}
     GROUP BY b.mentor_id
     ORDER BY gross_earnings DESC`,
    params,
  );

  logger.info("Weekly earnings report generated", {
    jobId: job.id,
    rows: rows.length,
    periodStart,
    periodEnd,
  });

  // In a real system you'd persist this or email it; for now we log the summary
  if (rows.length === 0) {
    logger.info("No earnings data for period", { periodStart, periodEnd });
  }
}

export const reportWorker = new Worker<ReportJobData>(
  QUEUE_NAMES.REPORT,
  generateWeeklyEarningsReport,
  {
    connection: redisConnection,
    concurrency: CONCURRENCY.REPORT,
  },
);

reportWorker.on("completed", (job) => {
  logger.info("Report job completed", {
    jobId: job.id,
    reportType: job.data.reportType,
  });
});

reportWorker.on("failed", (job, err) => {
  logger.error("Report job failed", {
    jobId: job?.id,
    reportType: job?.data?.reportType,
    attempt: job?.attemptsMade,
    error: err.message,
  });
});

reportWorker.on("error", (err) => {
  logger.error("Report worker error", { error: err.message });
});
